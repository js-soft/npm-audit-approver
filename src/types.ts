export interface AppConfig {
    readonly appId: string
    readonly approvedAuthorEmail: string
    readonly port: number
    readonly privateKey: string
    readonly webhookSecret: string
}

export interface PullRequestWebhookPayload {
    readonly action: string
    readonly installation?: {
        readonly id: number
    }
    readonly pull_request: {
        readonly base: {
            readonly sha: string
        }
        readonly draft?: boolean
        readonly head: {
            readonly sha: string
        }
        readonly labels?: readonly PullRequestLabel[]
        readonly number: number
    }
    readonly repository: {
        readonly name: string
        readonly owner: {
            readonly login: string
        }
    }
}

export interface PullRequestCommit {
    readonly sha: string
    readonly commit: {
        readonly author?: {
            readonly email?: string | null
            readonly name?: string | null
        } | null
    }
}

export interface PullRequestFile {
    readonly filename: string
}

export interface PullRequestLabel {
    readonly name: string
}

export interface IssueComment {
    readonly body: string | null
}

export interface PullRequestReview {
    readonly body: string | null
    readonly commit_id: string
    readonly state: string
}

export interface ApprovalInput {
    readonly approvedAuthorEmail: string
    readonly baseNsprcContent?: string
    readonly commits: readonly PullRequestCommit[]
    readonly files: readonly PullRequestFile[]
    readonly headNsprcContent?: string
    readonly labels: readonly PullRequestLabel[]
}

export interface ApprovalDecision {
    readonly approve: boolean
    readonly reason: string
    readonly shouldComment: boolean
}
