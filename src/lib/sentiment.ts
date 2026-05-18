const POSITIVE_SIGNALS = [
  "obrigado", "obrigada", "ótimo", "perfeito", "adorei", "excelente", "parabéns",
  "funcionou", "resolvido", "show", "boa", "incrível", "top", "satisfeito", "feliz",
];

const NEGATIVE_SIGNALS = [
  "péssimo", "horrível", "absurdo", "decepcionado", "reclamação", "problema",
  "errado", "falhou", "nunca mais", "cancelar", "reembolso", "fraude", "raiva",
  "desapontado", "lamentável",
];

const URGENCY_SIGNALS = [
  "urgente", "urgência", "emergência", "crítico", "perda", "processo",
  "advogado", "procon", "consumidor.gov", "reclame aqui",
];

const QUESTION_PATTERNS = [/\?/, /como\s/, /quando\s/, /onde\s/, /qual\s/, /\bdúvida\b/i, /\bprazo\b/i];

export type ResponseClass = "URGENT" | "COMPLAINT" | "QUESTION" | "POSITIVE" | "ROUTINE";

export const scoreSentiment = (messages: any[]): {
  score: number;
  mood: string;
  urgencyFlag: boolean;
  signals: string[];
} => {
  const inbound = messages
    .filter((m: any) => m.direction === "INBOUND" || !m.direction)
    .map((m: any) => (m.body ?? "").toLowerCase())
    .join(" ");

  let score = 0;
  const detectedSignals: string[] = [];

  for (const signal of POSITIVE_SIGNALS) {
    if (inbound.includes(signal)) { score += 1; detectedSignals.push(`+${signal}`); }
  }
  for (const signal of NEGATIVE_SIGNALS) {
    if (inbound.includes(signal)) { score -= 2; detectedSignals.push(`-${signal}`); }
  }

  const urgencyFlag = URGENCY_SIGNALS.some((signal) => inbound.includes(signal));
  if (urgencyFlag) score -= 5;

  const mood = score >= 2 ? "POSITIVE" : score <= -3 ? "NEGATIVE" : "NEUTRAL";
  return { score, mood, urgencyFlag, signals: detectedSignals };
};

export const classifyResponse = (text: string): ResponseClass => {
  const normalized = text.toLowerCase();
  if (URGENCY_SIGNALS.some((s) => normalized.includes(s))) return "URGENT";
  if (NEGATIVE_SIGNALS.some((s) => normalized.includes(s))) return "COMPLAINT";
  if (QUESTION_PATTERNS.some((p) => p.test(normalized))) return "QUESTION";
  if (POSITIVE_SIGNALS.some((s) => normalized.includes(s))) return "POSITIVE";
  return "ROUTINE";
};
