import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const registerAllPrompts = (server: McpServer): void => {
  server.registerPrompt(
    "send_first_message",
    {
      title: "Send a WhatsApp message",
      description: "Burro-first send: resolve who, send the text, and handle the 24h window gracefully if it is closed.",
      argsSchema: {
        to: z.string().describe("Quem receber: número (qualquer formato) ou nome de contato salvo"),
        message: z.string().describe("O que escrever, em linguagem natural"),
      },
    },
    async ({ to, message }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Mande uma mensagem de WhatsApp pra **${to}**: "${message}".`,
            ``,
            `1. Chame \`send_whatsapp\` com to="${to}" e a mensagem. Ele resolve número, E.164 e nono dígito sozinho.`,
            `2. Se a janela de 24h estiver fechada, ele vai listar os templates aprovados ou sugerir aprovar um novo. Mostre as opções ao operador e siga a escolha dele — não invente template.`,
            `3. Reporte o resultado (entregue/custo) ou o próximo passo de forma direta.`,
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "run_broadcast",
    {
      title: "Broadcast an approved template",
      description: "Pick an approved template, confirm the audience, and dispatch a broadcast with operator approval.",
      argsSchema: {
        audience: z.string().describe("Quem alcançar (ex: 'clientes de junho', lista de números)"),
        goal: z.string().describe("O objetivo (ex: 'avisar da promo', 'lembrar do boleto')"),
      },
    },
    async ({ audience, goal }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Planeje um broadcast. Objetivo: ${goal}. Público: ${audience}.`,
            ``,
            `1. Leia \`arara://templates/approved\` e escolha o template que melhor encaixa no objetivo. Se nenhum servir, sugira aprovar um com \`create_template\` e pare.`,
            `2. Leia \`arara://opt-outs\` e \`arara://wallet/balance\`: não inclua quem deu opt-out e confirme que há saldo.`,
            `3. Monte a lista de destinatários (números ou nomes salvos) a partir do público.`,
            `4. Confirme com o operador (template + tamanho da lista) ANTES de disparar. Só então chame \`broadcast\` com o templateName escolhido.`,
            `5. Reporte campanha criada + custo. Nunca dispare sem aprovação explícita.`,
          ].join("\n"),
        },
      }],
    }),
  );
};
