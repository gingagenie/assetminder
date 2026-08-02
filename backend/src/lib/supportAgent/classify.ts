import Anthropic from "@anthropic-ai/sdk";
import { FAQ_CONTENT } from "./faq";

export interface ClassificationResult {
  category: "setup" | "billing" | "feature_question" | "bug_report" | "account" | "other";
  confidence: number;
  draft_reply: string;
  tone: "neutral" | "frustrated" | "urgent" | "positive";
}

const SYSTEM_PROMPT = `You are a support email classifier for MinderApps, makers of AssetMinder and ContractMinder — tools for field service businesses that use Jobber.

Classify the incoming support email and draft a clear, friendly reply. Use the knowledge base below.

${FAQ_CONTENT}

Guidelines for draft_reply:
- Be friendly, warm, and professional
- Keep it concise: 2-4 short paragraphs max
- Reference specific steps from the knowledge base when applicable
- Do NOT speculate about billing disputes, refunds, or bug fixes — those need human review
- End every reply with: "If you need further help, just reply to this email and we'll be happy to assist.\n\nWarm regards,\nMinderApps Support"
- Do NOT include a subject line in the reply

Confidence score guidance:
- 0.9+ : FAQ topic, clear question, confident complete answer in the knowledge base
- 0.75-0.9: Probably answerable but some uncertainty or nuance
- Below 0.75: Unclear, sensitive, or not covered in the knowledge base`;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_email",
  description: "Classify the support email and produce a draft reply",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["setup", "billing", "feature_question", "bug_report", "account", "other"],
        description: "Primary topic category of the email",
      },
      confidence: {
        type: "number",
        description: "Confidence 0.0-1.0 that the draft reply is accurate and complete",
      },
      draft_reply: {
        type: "string",
        description: "Friendly, helpful reply to send to the customer",
      },
      tone: {
        type: "string",
        enum: ["neutral", "frustrated", "urgent", "positive"],
        description: "Emotional tone of the incoming email",
      },
    },
    required: ["category", "confidence", "draft_reply", "tone"],
  },
};

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function classifyEmail(
  fromEmail: string,
  subject: string,
  body: string,
): Promise<ClassificationResult> {
  const truncatedBody =
    body.length > 4000 ? body.slice(0, 4000) + "\n[... body truncated]" : body;

  const userContent = `From: ${fromEmail}\nSubject: ${subject}\n\n${truncatedBody}`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tool_choice: { type: "tool", name: "classify_email" },
    tools: [CLASSIFY_TOOL],
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );

  if (!toolUse) {
    throw new Error("Classifier returned no tool_use block");
  }

  return toolUse.input as ClassificationResult;
}
