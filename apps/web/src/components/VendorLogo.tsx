type VendorLogoProps = {
  name: string;
  size?: number;
};

const VENDOR_LOGO_RULES: Array<[RegExp, string]> = [
  [/anthropic|claude/i, "anthropic"],
  [/openai|chatgpt|\bgpt[-\s]|\bo[134](?:[-\s]|$)/i, "openai"],
  [/google/i, "google"],
  [/gemini|gemma|imagen|\bveo[-\s]/i, "gemini"],
  [/deepseek/i, "deepseek"],
  [/moonshot|kimi/i, "moonshot"],
  [/minimax|\babab/i, "minimax"],
  [/qwen|qwq|alibaba|dashscope/i, "qwen"],
  [/zhipu|chatglm|\bglm[-\s]|cogview|cogvideo/i, "zhipu"],
  [/mistral|mixtral|codestral|pixtral|voxtral|magistral/i, "mistral"],
  [/meta|llama/i, "meta"],
  [/cohere|\bcommand[-\s]|c4ai/i, "cohere"],
  [/zero\s?one|01\.ai|\byi[-\s]/i, "yi"],
  [/\bxai\b|\bx\.ai\b|grok/i, "xai"],
  [/doubao|bytedance|volcengine/i, "doubao"],
  [/wenxin|baidu|ernie/i, "wenxin"],
  [/iflytek|spark/i, "spark"],
  [/hunyuan|tencent/i, "hunyuan"],
  [/cloudflare|@cf\//i, "cloudflare"],
  [/midjourney|\bmj[-_]/i, "midjourney"],
  [/perplexity|pplx/i, "perplexity"],
  [/jina/i, "jina"],
  [/openrouter/i, "openrouter"],
  [/suno/i, "suno"],
  [/ollama/i, "ollama"],
  [/\b360\b/i, "ai360"],
  [/dify/i, "dify"],
  [/coze/i, "coze"]
];

export function vendorLogoSlug(name: string): string | null {
  return VENDOR_LOGO_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function VendorLogo({ name, size = 20 }: VendorLogoProps) {
  const slug = vendorLogoSlug(name);
  if (!slug) return null;
  return (
    <img
      src={`/vendor-logos/${slug}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      style={{ display: "block", flex: "0 0 auto", objectFit: "contain" }}
    />
  );
}
