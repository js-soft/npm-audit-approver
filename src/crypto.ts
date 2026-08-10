import { createHmac, createSign, timingSafeEqual } from "node:crypto"

export function createAppJwt(appId: string, privateKey: string, nowInSeconds = Math.floor(Date.now() / 1000)): string {
    const header = base64UrlEncodeJson({
        alg: "RS256",
        typ: "JWT"
    })
    const payload = base64UrlEncodeJson({
        exp: nowInSeconds + 9 * 60,
        iat: nowInSeconds - 60,
        iss: appId
    })
    const unsignedToken = `${header}.${payload}`
    const signature = createSign("RSA-SHA256").update(unsignedToken).sign(privateKey, "base64url")

    return `${unsignedToken}.${signature}`
}

export function verifyWebhookSignature(body: Buffer, signatureHeader: string | undefined, secret: string): boolean {
    const expectedPrefix = "sha256="

    if (!signatureHeader?.startsWith(expectedPrefix)) {
        return false
    }

    const receivedSignature = signatureHeader.slice(expectedPrefix.length)
    const expectedSignature = createHmac("sha256", secret).update(body).digest("hex")

    const received = Buffer.from(receivedSignature, "hex")
    const expected = Buffer.from(expectedSignature, "hex")

    return received.length === expected.length && timingSafeEqual(received, expected)
}

function base64UrlEncodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url")
}
