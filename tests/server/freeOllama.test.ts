import { expect, test } from "bun:test";
import { buildFreeOllamaGroups, eligibleFreeOllamaEntries, eligibleFreeOllamaModels } from "../../backends/relay-config/src/relay/freeOllama.ts";

test("filters Free Ollama embeddings and models below 7B", () => {
  expect(eligibleFreeOllamaModels([
    "nomic-embed-text:latest",
    "qwen3-embedding:0.6b",
    "smollm2:135m",
    "llama3.2:3b",
    "qwen3:7b",
    "llama3.1:8b",
    "mistral:latest",
    "glm-4.7:cloud",
    "deepseek-r1:14b",
    "gpt-oss:20b",
    "minimax-m2.5:cloud",
    "kimi-k2-thinking:cloud",
    "verif_sys:latest",
    "gemma3:12b",
    "phi4:14b",
    "tinyllama:latest",
    "llama3.2:latest"
  ])).toEqual([
    "qwen3:7b",
    "llama3.1:8b",
    "mistral:latest",
    "glm-4.7:cloud",
    "deepseek-r1:14b",
    "gpt-oss:20b",
    "minimax-m2.5:cloud",
    "kimi-k2-thinking:cloud"
  ]);
});

test("creates one OpenAI Chat group per server using that server's own Base URL", () => {
  const groups = buildFreeOllamaGroups([
    { server: "https://one.example", models: ["mistral:latest"], tps: 80, status: "success" },
    { server: "http://two.example:11434", models: ["gpt-oss:20b"], tps: 90, status: "success" }
  ]);
  expect(groups.map((group) => ({ name: group.name, baseUrl: group.baseUrl, protocol: group.responseProtocol, models: group.models }))).toEqual([
    { name: "one.example", baseUrl: "https://one.example/v1", protocol: "openai", models: ["mistral:latest"] },
    { name: "two.example:11434", baseUrl: "http://two.example:11434/v1", protocol: "openai", models: ["gpt-oss:20b"] }
  ]);
  expect(groups[0]?.modelCapabilities?.["mistral:latest"]?.reasoningEfforts).toEqual(["none"]);
  expect(groups[1]?.modelCapabilities?.["gpt-oss:20b"]?.reasoningEfforts).toEqual(["low", "medium", "high"]);
});

test("imports only healthy Free Ollama servers at or above 60 TPS", () => {
  const result = eligibleFreeOllamaEntries([
    { server: "https://fast.example/", models: ["qwen"], tps: 60, status: "success" },
    { server: "https://slow.example", models: ["qwen"], tps: 59.99, status: "success" },
    { server: "https://fake.example", models: ["qwen"], tps: 100, status: "fake" },
    { server: "https://bad.example", models: [], tps: 100, status: "success" },
    { server: "https://FAST.example/", models: ["other"], tps: 80, status: "success" },
    { server: "not-a-url", models: ["qwen"], tps: 100, status: "success" }
  ]);
  expect(result.map((entry) => entry.server)).toEqual(["https://fast.example"]);
});
