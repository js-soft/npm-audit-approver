import { loadConfig } from "./config.js"
import { createAppServer } from "./server.js"

const config = loadConfig()
const server = createAppServer(config)

server.listen(config.port, () => {
    console.log(`Auto approve GitHub App listening on port ${config.port}.`)
})
