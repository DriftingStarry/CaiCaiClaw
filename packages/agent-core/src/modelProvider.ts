import { ChatOpenRouter } from "@langchain/openrouter";

export const createOpenrouterModel = (model: string) => new ChatOpenRouter({ model });
