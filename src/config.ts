import { readFileSync } from "node:fs"

import type { AppConfig } from "./types.js"

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const appId = requiredEnv(env, "GITHUB_APP_ID")
    const webhookSecret = requiredEnv(env, "GITHUB_WEBHOOK_SECRET")
    const privateKey = loadPrivateKey(env)
    const approvedAuthorEmail = env.APPROVED_AUTHOR_EMAIL?.trim() || "ci@js-soft.com"
    const port = parsePort(env.PORT)

    return {
        appId,
        approvedAuthorEmail,
        port,
        privateKey,
        webhookSecret
    }
}

function loadPrivateKey(env: NodeJS.ProcessEnv): string {
    const privateKey = env.GITHUB_PRIVATE_KEY?.trim()

    if (privateKey) {
        return privateKey.replaceAll("\\n", "\n")
    }

    const privateKeyPath = env.GITHUB_PRIVATE_KEY_PATH?.trim()

    if (privateKeyPath) {
        return readFileSync(privateKeyPath, "utf8")
    }

    throw new Error("Missing required environment variable GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH.")
}

function parsePort(value: string | undefined): number {
    if (!value) return 3000

    const port = Number(value)

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PORT '${value}'. Expected an integer between 1 and 65535.`)
    }

    return port
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim()

    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`)
    }

    return value
}
