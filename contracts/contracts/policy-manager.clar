;; ============================================================================
;; Policy Manager Contract - x402-Stacks Payment Policy Enforcement
;; ============================================================================
;; This contract manages spending policies for AI agents making x402 payments
;; Features: Daily limits, per-tx caps, service allowlists, multi-asset support

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant CONTRACT_OWNER tx-sender)

;; Error codes
(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_POLICY_NOT_FOUND (err u101))
(define-constant ERR_DAILY_LIMIT_EXCEEDED (err u102))
(define-constant ERR_PER_TX_LIMIT_EXCEEDED (err u103))
(define-constant ERR_SERVICE_NOT_APPROVED (err u104))
(define-constant ERR_AGENT_PAUSED (err u105))
(define-constant ERR_AGENT_REVOKED (err u106))
(define-constant ERR_INVALID_AMOUNT (err u107))
(define-constant ERR_FACILITATOR_NOT_APPROVED (err u108))

;; Asset types
(define-constant ASSET_STX u1)
(define-constant ASSET_SBTC u2)

;; ============================================================================
;; DATA STRUCTURES
;; ============================================================================

;; Policy definition for an agent
(define-map policies
  { agent: principal }
  {
    daily-limit-stx: uint,           ;; Max STX per day (microSTX)
    daily-limit-sbtc: uint,          ;; Max sBTC per day (satoshis)
    per-tx-limit-stx: uint,          ;; Max STX per transaction
    per-tx-limit-sbtc: uint,         ;; Max sBTC per transaction
    owner: principal,                ;; Policy owner (can modify)
    created-at: uint,                ;; Block height when created
    is-active: bool                  ;; Active status
  }
)

;; Daily spending tracker (resets each day via Bitcoin block height)
(define-map daily-spending
  { agent: principal, day: uint }
  {
    stx-spent: uint,
    sbtc-spent: uint,
    last-updated: uint
  }
)

;; Approved services per agent (allowlist)
(define-map approved-services
  { agent: principal, service: (string-ascii 256) }
  { approved: bool }
)

;; Approved facilitators per agent
(define-map approved-facilitators
  { agent: principal, facilitator: principal }
  { approved: bool }
)

;; Emergency controls
(define-map agent-status
  { agent: principal }
  {
    paused: bool,
    revoked: bool,
    paused-at: uint,
    revoked-at: uint
  }
)

;; Payment history for audit trail
(define-map payment-history
  { agent: principal, payment-id: uint }
  {
    amount: uint,
    asset-type: uint,
    service: (string-ascii 256),
    timestamp: uint,
    tx-id: (optional (buff 32)),
    approved: bool,
    block-height: uint
  }
)

;; Counter for payment IDs
(define-map payment-counters
  { agent: principal }
  { count: uint }
)

;; ============================================================================
;; READ-ONLY FUNCTIONS
;; ============================================================================

;; Get policy for an agent
(define-read-only (get-policy (agent principal))
  (map-get? policies { agent: agent })
)

;; Get daily spending for an agent
(define-read-only (get-daily-spending (agent principal))
  (let ((current-day (get-current-day)))
    (default-to
      { stx-spent: u0, sbtc-spent: u0, last-updated: u0 }
      (map-get? daily-spending { agent: agent, day: current-day })
    )
  )
)

;; Check if service is approved for agent
(define-read-only (is-service-approved (agent principal) (service (string-ascii 256)))
  (default-to
    false
    (get approved (map-get? approved-services { agent: agent, service: service }))
  )
)

;; Check if facilitator is approved for agent
(define-read-only (is-facilitator-approved (agent principal) (facilitator principal))
  (default-to
    false
    (get approved (map-get? approved-facilitators { agent: agent, facilitator: facilitator }))
  )
)

;; Get agent status (paused/revoked)
(define-read-only (get-agent-status (agent principal))
  (default-to
    { paused: false, revoked: false, paused-at: u0, revoked-at: u0 }
    (map-get? agent-status { agent: agent })
  )
)

;; Check if agent is active
(define-read-only (is-agent-active (agent principal))
  (let ((status (get-agent-status agent)))
    (and
      (not (get paused status))
      (not (get revoked status))
    )
  )
)

;; Get payment history entry
(define-read-only (get-payment (agent principal) (payment-id uint))
  (map-get? payment-history { agent: agent, payment-id: payment-id })
)

;; Get total payment count for agent
(define-read-only (get-payment-count (agent principal))
  (default-to
    { count: u0 }
    (map-get? payment-counters { agent: agent })
  )
)

;; Get current day (based on Bitcoin block height / 144 blocks per day)
(define-read-only (get-current-day)
  (/ burn-block-height u144)
)

;; ============================================================================
;; POLICY MANAGEMENT FUNCTIONS
;; ============================================================================

;; Create a new policy for an agent
(define-public (create-policy
  (agent principal)
  (daily-limit-stx uint)
  (daily-limit-sbtc uint)
  (per-tx-limit-stx uint)
  (per-tx-limit-sbtc uint)
)
  (begin
    ;; Only contract owner or agent owner can create policy
    (asserts! (or (is-eq tx-sender CONTRACT_OWNER) (is-eq tx-sender agent)) ERR_UNAUTHORIZED)
    
    ;; Create policy
    (ok (map-set policies
      { agent: agent }
      {
        daily-limit-stx: daily-limit-stx,
        daily-limit-sbtc: daily-limit-sbtc,
        per-tx-limit-stx: per-tx-limit-stx,
        per-tx-limit-sbtc: per-tx-limit-sbtc,
        owner: tx-sender,
        created-at: block-height,
        is-active: true
      }
    ))
  )
)

;; Update existing policy
(define-public (update-policy
  (agent principal)
  (daily-limit-stx uint)
  (daily-limit-sbtc uint)
  (per-tx-limit-stx uint)
  (per-tx-limit-sbtc uint)
)
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    ;; Only policy owner can update
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-set policies
      { agent: agent }
      (merge policy {
        daily-limit-stx: daily-limit-stx,
        daily-limit-sbtc: daily-limit-sbtc,
        per-tx-limit-stx: per-tx-limit-stx,
        per-tx-limit-sbtc: per-tx-limit-sbtc
      })
    ))
  )
)

;; Delete policy
(define-public (delete-policy (agent principal))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    (ok (map-delete policies { agent: agent }))
  )
)

;; ============================================================================
;; SERVICE MANAGEMENT FUNCTIONS
;; ============================================================================

;; Approve a service for an agent
(define-public (approve-service (agent principal) (service (string-ascii 256)))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-set approved-services
      { agent: agent, service: service }
      { approved: true }
    ))
  )
)

;; Revoke service approval
(define-public (revoke-service (agent principal) (service (string-ascii 256)))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-delete approved-services { agent: agent, service: service }))
  )
)

;; Approve a facilitator for an agent
(define-public (approve-facilitator (agent principal) (facilitator principal))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-set approved-facilitators
      { agent: agent, facilitator: facilitator }
      { approved: true }
    ))
  )
)

;; Revoke facilitator approval
(define-public (revoke-facilitator (agent principal) (facilitator principal))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-delete approved-facilitators { agent: agent, facilitator: facilitator }))
  )
)

;; ============================================================================
;; PAYMENT VALIDATION FUNCTIONS
;; ============================================================================

;; Main function: Check if payment is allowed
(define-public (check-payment-allowed
  (agent principal)
  (amount uint)
  (asset-type uint)
  (service (string-ascii 256))
  (facilitator principal)
)
  (let (
    (policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND))
    (current-day (get-current-day))
    (spending (get-daily-spending agent))
    (status (get-agent-status agent))
  )
    ;; Check 1: Agent not paused or revoked
    (asserts! (not (get paused status)) ERR_AGENT_PAUSED)
    (asserts! (not (get revoked status)) ERR_AGENT_REVOKED)
    
    ;; Check 2: Valid amount
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    
    ;; Check 3: Per-transaction limit
    (if (is-eq asset-type ASSET_STX)
      (asserts! (<= amount (get per-tx-limit-stx policy)) ERR_PER_TX_LIMIT_EXCEEDED)
      (asserts! (<= amount (get per-tx-limit-sbtc policy)) ERR_PER_TX_LIMIT_EXCEEDED)
    )
    
    ;; Check 4: Daily limit
    (if (is-eq asset-type ASSET_STX)
      (asserts!
        (<= (+ (get stx-spent spending) amount) (get daily-limit-stx policy))
        ERR_DAILY_LIMIT_EXCEEDED
      )
      (asserts!
        (<= (+ (get sbtc-spent spending) amount) (get daily-limit-sbtc policy))
        ERR_DAILY_LIMIT_EXCEEDED
      )
    )
    
    ;; Check 5: Service approved
    (asserts! (is-service-approved agent service) ERR_SERVICE_NOT_APPROVED)
    
    ;; Check 6: Facilitator approved
    (asserts! (is-facilitator-approved agent facilitator) ERR_FACILITATOR_NOT_APPROVED)
    
    (ok true)
  )
)

;; Record a successful payment
(define-public (record-payment
  (agent principal)
  (amount uint)
  (asset-type uint)
  (service (string-ascii 256))
  (tx-id (optional (buff 32)))
)
  (let (
    (current-day (get-current-day))
    (spending (get-daily-spending agent))
    (counter (get-payment-count agent))
    (payment-id (+ (get count counter) u1))
  )
    ;; Update daily spending
    (if (is-eq asset-type ASSET_STX)
      (map-set daily-spending
        { agent: agent, day: current-day }
        {
          stx-spent: (+ (get stx-spent spending) amount),
          sbtc-spent: (get sbtc-spent spending),
          last-updated: block-height
        }
      )
      (map-set daily-spending
        { agent: agent, day: current-day }
        {
          stx-spent: (get stx-spent spending),
          sbtc-spent: (+ (get sbtc-spent spending) amount),
          last-updated: block-height
        }
      )
    )
    
    ;; Record payment in history
    (map-set payment-history
      { agent: agent, payment-id: payment-id }
      {
        amount: amount,
        asset-type: asset-type,
        service: service,
        timestamp: block-height,
        tx-id: tx-id,
        approved: true,
        block-height: burn-block-height
      }
    )
    
    ;; Increment counter
    (map-set payment-counters
      { agent: agent }
      { count: payment-id }
    )
    
    ;; Emit event
    (print {
      event: "payment-recorded",
      agent: agent,
      payment-id: payment-id,
      amount: amount,
      asset-type: asset-type,
      service: service
    })
    
    (ok payment-id)
  )
)

;; ============================================================================
;; EMERGENCY CONTROL FUNCTIONS
;; ============================================================================

;; Pause an agent (temporarily disable all payments)
(define-public (pause-agent (agent principal))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-set agent-status
      { agent: agent }
      {
        paused: true,
        revoked: false,
        paused-at: block-height,
        revoked-at: u0
      }
    ))
  )
)

;; Unpause an agent
(define-public (unpause-agent (agent principal))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-set agent-status
      { agent: agent }
      {
        paused: false,
        revoked: false,
        paused-at: u0,
        revoked-at: u0
      }
    ))
  )
)

;; Revoke an agent (permanently disable - cannot be undone)
(define-public (revoke-agent (agent principal))
  (let ((policy (unwrap! (get-policy agent) ERR_POLICY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (get owner policy)) ERR_UNAUTHORIZED)
    
    (ok (map-set agent-status
      { agent: agent }
      {
        paused: false,
        revoked: true,
        paused-at: u0,
        revoked-at: block-height
      }
    ))
  )
)
