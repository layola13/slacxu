export type ThreadItem =
  | { type: "user"; text: string }
  | { type: "message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "function_call"; callId: string; name: string; args: string }
  | { type: "function_call_output"; callId: string; output: string; images?: string[] }
  | { type: "plan"; plan: Array<{ step: string; status: string }>; text: string };

export type ToolDef = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type TurnResult = {
  items: ThreadItem[];
  calls: Array<{ callId: string; name: string; args: string }>;
  text: string;
  /** Stored response id (responses protocol) for previous_response_id chaining. */
  responseId?: string;
};
