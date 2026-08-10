import assert from "node:assert/strict"
import test from "node:test"

import { decideApproval } from "./approval.js"
import type { PullRequestCommit } from "./types.js"

test("approves when every commit is authored by the approved email", () => {
    const decision = decideApproval(
        [commit("1111111", "ci@js-soft.com"), commit("2222222", "CI@JS-SOFT.COM")],
        "ci@js-soft.com"
    )

    assert.equal(decision.approve, true)
})

test("does not approve when a commit has a different author email", () => {
    const decision = decideApproval(
        [commit("1111111", "ci@js-soft.com"), commit("2222222", "person@example.com")],
        "ci@js-soft.com"
    )

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /person@example.com/)
})

test("does not approve pull requests without commits", () => {
    const decision = decideApproval([], "ci@js-soft.com")

    assert.equal(decision.approve, false)
})

function commit(sha: string, authorEmail: string): PullRequestCommit {
    return {
        commit: {
            author: {
                email: authorEmail,
                name: "CI"
            }
        },
        sha
    }
}
