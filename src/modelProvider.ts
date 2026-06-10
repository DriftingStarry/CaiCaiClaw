import { ChatOpenRouter } from "@langchain/openrouter"

export const getOpenrouterModel = () => {
    const modelEnv = process.env.OPENROUTER_MODEL
    if (!modelEnv) throw Error('OPENROUTER_MODEL env not set!')
    const openrouterModel = new ChatOpenRouter(
        {
            model:process.env.OPENROUTER_MODEL
        }
    )
    return openrouterModel
}
