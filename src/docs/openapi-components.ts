/**
 * @openapi
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     # ──────────────────────────────────────────────────────────────
 *     # Auth
 *     # ──────────────────────────────────────────────────────────────
 *     AuthEmailRequest:
 *       type: object
 *       required: [email]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: alice@example.com
 *
 *     AuthWalletRequest:
 *       type: object
 *       required: [address, signature, message]
 *       properties:
 *         address:
 *           type: string
 *           description: Polkadot SS58 address
 *           example: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
 *         signature:
 *           type: string
 *           description: Hex-encoded signature (0x…)
 *           example: 0x8f5a4c2e1b...
 *         message:
 *           type: string
 *           description: "Must include Timestamp: <ISO> (e.g., Timestamp: 2025-11-05T12:34:56Z)"
 *           example: |
 *             Sign this message to authenticate with Nani.
 *             Timestamp: 2025-11-05T12:34:56.789Z
 *
 *     AuthSuccessResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *         tenantId:
 *           type: string
 *         method:
 *           type: string
 *           enum: [email, wallet]
 *         address:
 *           type: string
 *           nullable: true
 *
 *     # ──────────────────────────────────────────────────────────────
 *     # Setup
 *     # ──────────────────────────────────────────────────────────────
 *     ChainSetup:
 *       type: object
 *       required: [chainId, address, plugins]
 *       properties:
 *         chainId:
 *           type: string
 *           example: westend
 *         address:
 *           type: string
 *           example: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
 *         plugins:
 *           type: object
 *           required: [activities, notifications]
 *           properties:
 *             activities:
 *               type: array
 *               items:
 *                 type: string
 *               minItems: 1
 *               example: [transfer]
 *             notifications:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/NotificationConfig'
 *
 *     NotificationConfig:
 *       type: object
 *       required: [type, config]
 *       properties:
 *         type:
 *           type: string
 *           example: discord
 *         config:
 *           type: object
 *           example:
 *             webhookUrl: https://discord.com/api/webhooks/...
 *
 *     SetupRequest:
 *       type: object
 *       required: [setups]
 *       properties:
 *         setups:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChainSetup'
 *           minItems: 1
 *
 *     SetupResult:
 *       type: object
 *       properties:
 *         chainId:
 *           type: string
 *         success:
 *           type: boolean
 *         address:
 *           type: string
 *           nullable: true
 *         tokenSymbol:
 *           type: string
 *           nullable: true
 *         error:
 *           type: string
 *           nullable: true
 *
 *     SetupSuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         results:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SetupResult'
 *
 *     SetupErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         results:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SetupResult'
 *
 *     # ──────────────────────────────────────────────────────────────
 *     # Stats
 *     # ──────────────────────────────────────────────────────────────
 *     StatsFilters:
 *       type: object
 *       properties:
 *         chainId:
 *           type: string
 *           nullable: true
 *         from:
 *           type: string
 *           format: date
 *           nullable: true
 *         to:
 *           type: string
 *           format: date
 *           nullable: true
 *
 *     ChainStorageStat:
 *       type: object
 *       properties:
 *         chainId:
 *           type: string
 *         logCount:
 *           type: integer
 *         sizeBytes:
 *           type: integer
 *
 *     StorageMetadata:
 *       type: object
 *       properties:
 *         totalSizeBytes:
 *           type: integer
 *         totalSizeMB:
 *           type: number
 *           format: float
 *         logFileCount:
 *           type: integer
 *         chainCount:
 *           type: integer
 *         chains:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChainStorageStat'
 *
 *     StatsResult:
 *       type: object
 *       properties:
 *         logsProcessed:
 *           type: integer
 *         stats:
 *           type: object
 *           additionalProperties: true
 *
 *     StatsResponse:
 *       type: object
 *       properties:
 *         plugin:
 *           type: string
 *         filters:
 *           $ref: '#/components/schemas/StatsFilters'
 *         result:
 *           $ref: '#/components/schemas/StatsResult'
 *         storage:
 *           $ref: '#/components/schemas/StorageMetadata'
 *         generatedAt:
 *           type: string
 *           format: date-time
 *
 *     # ──────────────────────────────────────────────────────────────
 *     # Health
 *     # ──────────────────────────────────────────────────────────────
 *     HealthResponse:
 *       type: object
 *       required: [status, timestamp]
 *       properties:
 *         status:
 *           type: string
 *           enum: [ok]
 *         timestamp:
 *           type: string
 *           format: date-time
 */
export {};
