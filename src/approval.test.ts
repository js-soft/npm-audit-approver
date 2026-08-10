import assert from "node:assert/strict"
import test from "node:test"

import { decideApproval, pullRequestActionsToEvaluate } from "./approval.js"
import type { ApprovalInput, PullRequestCommit } from "./types.js"

test("evaluates pull requests when a label is added", () => {
    assert.equal(pullRequestActionsToEvaluate.has("labeled"), true)
})

test("approves when every commit is authored by the approved email", () => {
    const decision = decideApproval({
        ...approvalInput(),
        commits: [commit("1111111", "ci@js-soft.com"), commit("2222222", "CI@JS-SOFT.COM")]
    })

    assert.equal(decision.approve, true)
})

test("does not approve when a commit has a different author email", () => {
    const decision = decideApproval({
        ...approvalInput(),
        commits: [commit("1111111", "ci@js-soft.com"), commit("2222222", "person@example.com")]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /person@example.com/)
})

test("does not approve pull requests without commits", () => {
    const decision = decideApproval({
        ...approvalInput(),
        commits: []
    })

    assert.equal(decision.approve, false)
})

test("does not approve when files outside package-lock.json and .nsprc changed", () => {
    const decision = decideApproval({
        ...approvalInput(),
        files: [{ filename: "package-lock.json" }, { filename: "src/index.ts" }]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /src\/index\.ts/)
})

test("does not approve without dependencies or chore label", () => {
    const decision = decideApproval({
        ...approvalInput(),
        labels: [{ name: "security" }]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /dependencies or chore/)
})

test("approves at most two added low or medium nsprc exceptions", () => {
    const decision = decideApproval({
        ...approvalInput(),
        baseNsprcContent: JSON.stringify({
            "GHSA-existing": {
                severity: "high"
            }
        }),
        files: [{ filename: "package-lock.json" }, { filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-existing": {
                severity: "high"
            },
            "GHSA-low": {
                severity: "Low"
            },
            "GHSA-medium": {
                severity: "Medium"
            }
        })
    })

    assert.equal(decision.approve, true)
})

test("does not approve more than two added nsprc exceptions", () => {
    const decision = decideApproval({
        ...approvalInput(),
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-one": {
                severity: "low"
            },
            "GHSA-two": {
                severity: "medium"
            },
            "GHSA-three": {
                severity: "low"
            }
        })
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /more than 2/)
})

test("does not approve added nsprc exceptions above medium severity", () => {
    const decision = decideApproval({
        ...approvalInput(),
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-high": {
                severity: "high"
            }
        })
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /GHSA-high:high/)
})

test("does not approve added nsprc exceptions without severity", () => {
    const decision = decideApproval({
        ...approvalInput(),
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-missing": "legacy exception note"
        })
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /GHSA-missing:missing-severity/)
})

function approvalInput(): ApprovalInput {
    return {
        approvedAuthorEmail: "ci@js-soft.com",
        commits: [commit("1111111", "ci@js-soft.com")],
        files: [{ filename: "package-lock.json" }],
        labels: [{ name: "dependencies" }]
    }
}

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
