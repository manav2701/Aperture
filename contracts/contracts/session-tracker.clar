;; ============================================================================
;; Session Tracker Contract - x402-Stacks V2 Session Management
;; ============================================================================
;; This contract manages payment sessions for AI agents
;; Features: Session budgets, timeout tracking, cumulative spending

;; ============================================================================
;; CONSTANTS
;; ============================================================================

(define-constant CONTRACT_OWNER tx-sender)

;; Error codes
(define-constant ERR_UNAUTHORIZED (err u200))
(define-constant ERR_SESSION_NOT_FOUND (err u201))
(define-constant ERR_SESSION_EXPIRED (err u202))
(define-constant ERR_SESSION_BUDGET_EXCEEDED (err u203))
(define-constant ERR_SESSION_ALREADY_ENDED (err u204))
(define-constant ERR_INVALID_TIMEOUT (err u205))

;; Session constants
(define-constant MAX_SESSION_TIMEOUT u86400) ;; 24 hours in seconds (144 Bitcoin blocks)
(define-constant DEFAULT_SESSION_TIMEOUT u3600) ;; 1 hour default

;; ============================================================================
;; DATA STRUCTURES
;; ============================================================================

;; Session definition
(define-map sessions
  { session-id: (buff 32) }
  {
    agent: principal,
    owner: principal,
    budget-stx: uint,           ;; Total session budget in microSTX
    budget-sbtc: uint,          ;; Total session budget in satoshis
    spent-stx: uint,            ;; Amount spent so far (STX)
    spent-sbtc: uint,           ;; Amount spent so far (sBTC)
    created-at: uint,           ;; Block height when created
    expires-at: uint,           ;; Block height when session expires
    is-active: bool,            ;; Whether session is active
    ended-at: uint,             ;; Block height when ended (0 if still active)
    payment-count: uint         ;; Number of payments made in session
  }
)

;; Session payment history
(define-map session-payments
  { session-id: (buff 32), payment-index: uint }
  {
    amount: uint,
    asset-type: uint,
    service: (string-ascii 256),
    timestamp: uint,
    block-height: uint
  }
)

;; Agent session counter (for tracking number of sessions per agent)
(define-map agent-session-count
  { agent: principal }
  { count: uint }
)

;; ============================================================================
;; READ-ONLY FUNCTIONS
;; ============================================================================

;; Get session details
(define-read-only (get-session (session-id (buff 32)))
  (map-get? sessions { session-id: session-id })
)

;; Get session payment
(define-read-only (get-session-payment (session-id (buff 32)) (payment-index uint))
  (map-get? session-payments { session-id: session-id, payment-index: payment-index })
)

;; Check if session is active and valid
(define-read-only (is-session-valid (session-id (buff 32)))
  (match (get-session session-id)
    session
    (and
      (get is-active session)
      (<= burn-block-height (get expires-at session))
      (is-eq (get ended-at session) u0)
    )
    false
  )
)

;; Get remaining budget for session
(define-read-only (get-session-remaining-budget (session-id (buff 32)))
  (match (get-session session-id)
    session
    (ok {
      stx-remaining: (- (get budget-stx session) (get spent-stx session)),
      sbtc-remaining: (- (get budget-sbtc session) (get spent-sbtc session))
    })
    ERR_SESSION_NOT_FOUND
  )
)

;; Get session utilization percentage (0-100)
(define-read-only (get-session-utilization (session-id (buff 32)))
  (match (get-session session-id)
    session
    (ok {
      stx-percent: (if (> (get budget-stx session) u0)
        (/ (* (get spent-stx session) u100) (get budget-stx session))
        u0
      ),
      sbtc-percent: (if (> (get budget-sbtc session) u0)
        (/ (* (get spent-sbtc session) u100) (get budget-sbtc session))
        u0
      )
    })
    ERR_SESSION_NOT_FOUND
  )
)

;; Get total session count for agent
(define-read-only (get-agent-session-count (agent principal))
  (default-to
    { count: u0 }
    (map-get? agent-session-count { agent: agent })
  )
)

;; ============================================================================
;; SESSION MANAGEMENT FUNCTIONS
;; ============================================================================

;; Create a new session
(define-public (create-session
  (session-id (buff 32))
  (agent principal)
  (budget-stx uint)
  (budget-sbtc uint)
  (timeout-blocks uint)
)
  (let (
    (validated-timeout (if (> timeout-blocks MAX_SESSION_TIMEOUT)
      MAX_SESSION_TIMEOUT
      (if (is-eq timeout-blocks u0)
        DEFAULT_SESSION_TIMEOUT
        timeout-blocks
      )
    ))
    (agent-count (get-agent-session-count agent))
  )
    ;; Only agent owner or contract owner can create session
    (asserts! (or (is-eq tx-sender agent) (is-eq tx-sender CONTRACT_OWNER)) ERR_UNAUTHORIZED)
    
    ;; Create session
    (map-set sessions
      { session-id: session-id }
      {
        agent: agent,
        owner: tx-sender,
        budget-stx: budget-stx,
        budget-sbtc: budget-sbtc,
        spent-stx: u0,
        spent-sbtc: u0,
        created-at: block-height,
        expires-at: (+ burn-block-height validated-timeout),
        is-active: true,
        ended-at: u0,
        payment-count: u0
      }
    )
    
    ;; Increment agent session count
    (map-set agent-session-count
      { agent: agent }
      { count: (+ (get count agent-count) u1) }
    )
    
    ;; Emit event
    (print {
      event: "session-created",
      session-id: session-id,
      agent: agent,
      budget-stx: budget-stx,
      budget-sbtc: budget-sbtc,
      expires-at: (+ burn-block-height validated-timeout)
    })
    
    (ok session-id)
  )
)

;; Track a payment in a session
(define-public (track-session-payment
  (session-id (buff 32))
  (amount uint)
  (asset-type uint)
  (service (string-ascii 256))
)
  (let (
    (session (unwrap! (get-session session-id) ERR_SESSION_NOT_FOUND))
  )
    ;; Check session is valid
    (asserts! (is-session-valid session-id) ERR_SESSION_EXPIRED)
    
    ;; Check budget not exceeded
    (if (is-eq asset-type u1) ;; STX
      (asserts!
        (<= (+ (get spent-stx session) amount) (get budget-stx session))
        ERR_SESSION_BUDGET_EXCEEDED
      )
      (asserts!
        (<= (+ (get spent-sbtc session) amount) (get budget-sbtc session))
        ERR_SESSION_BUDGET_EXCEEDED
      )
    )
    
    ;; Update session spending
    (let ((new-payment-count (+ (get payment-count session) u1)))
      (map-set sessions
        { session-id: session-id }
        (merge session {
          spent-stx: (if (is-eq asset-type u1)
            (+ (get spent-stx session) amount)
            (get spent-stx session)
          ),
          spent-sbtc: (if (is-eq asset-type u2)
            (+ (get spent-sbtc session) amount)
            (get spent-sbtc session)
          ),
          payment-count: new-payment-count
        })
      )
      
      ;; Record payment in history
      (map-set session-payments
        { session-id: session-id, payment-index: new-payment-count }
        {
          amount: amount,
          asset-type: asset-type,
          service: service,
          timestamp: block-height,
          block-height: burn-block-height
        }
      )
      
      ;; Emit event
      (print {
        event: "session-payment",
        session-id: session-id,
        payment-index: new-payment-count,
        amount: amount,
        asset-type: asset-type,
        service: service
      })
      
      (ok new-payment-count)
    )
  )
)

;; End a session (manual termination)
(define-public (end-session (session-id (buff 32)))
  (let (
    (session (unwrap! (get-session session-id) ERR_SESSION_NOT_FOUND))
  )
    ;; Only session owner can end it
    (asserts! (is-eq tx-sender (get owner session)) ERR_UNAUTHORIZED)
    
    ;; Check session not already ended
    (asserts! (is-eq (get ended-at session) u0) ERR_SESSION_ALREADY_ENDED)
    
    ;; Update session
    (map-set sessions
      { session-id: session-id }
      (merge session {
        is-active: false,
        ended-at: block-height
      })
    )
    
    ;; Emit event
    (print {
      event: "session-ended",
      session-id: session-id,
      spent-stx: (get spent-stx session),
      spent-sbtc: (get spent-sbtc session),
      payment-count: (get payment-count session)
    })
    
    (ok true)
  )
)

;; Extend session timeout
(define-public (extend-session (session-id (buff 32)) (additional-blocks uint))
  (let (
    (session (unwrap! (get-session session-id) ERR_SESSION_NOT_FOUND))
    (new-expiry (+ (get expires-at session) additional-blocks))
  )
    ;; Only session owner can extend
    (asserts! (is-eq tx-sender (get owner session)) ERR_UNAUTHORIZED)
    
    ;; Check session still active
    (asserts! (is-session-valid session-id) ERR_SESSION_EXPIRED)
    
    ;; Check new expiry doesn't exceed max
    (asserts!
      (<= (- new-expiry burn-block-height) MAX_SESSION_TIMEOUT)
      ERR_INVALID_TIMEOUT
    )
    
    ;; Update session
    (ok (map-set sessions
      { session-id: session-id }
      (merge session { expires-at: new-expiry })
    ))
  )
)

;; ============================================================================
;; UTILITY FUNCTIONS
;; ============================================================================

;; Generate session ID from agent and nonce
(define-read-only (generate-session-id (agent principal) (nonce uint))
  (keccak256 (concat
    (unwrap-panic (to-consensus-buff? agent))
    (unwrap-panic (to-consensus-buff? nonce))
  ))
)
