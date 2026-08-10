import { createHmac } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"

import { verifyWebhookSignature } from "./crypto.js"

test("verifies a valid GitHub webhook signature", () => {
    const body = Buffer.from(JSON.stringify({ zen: "Keep it logically awesome." }))
    const secret = "super-secret"
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

    assert.equal(verifyWebhookSignature(body, signature, secret), true)
})

test("rejects an invalid GitHub webhook signature", () => {
    const body = Buffer.from("{}")

    assert.equal(verifyWebhookSignature(body, "sha256=deadbeef", "super-secret"), false)
})
