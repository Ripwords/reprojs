import { defineEventHandler } from "h3"
import { toNodeHandler } from "better-auth/node"
import { auth } from "../../lib/auth"

const nodeHandler = toNodeHandler(auth)

export default defineEventHandler(async (event) => {
  // better-auth/node gives us a standard Node.js (req, res) handler
  await nodeHandler(event.node.req, event.node.res)
})
