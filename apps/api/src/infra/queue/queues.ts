/** Queue names and deterministic job ids (BullMQ de-duplicates jobs with the same id while they are pending/active). */
export const QUEUES = {
  sms: 'sms',
  notifications: 'notifications',
  sessions: 'sessions',
  outbox: 'outbox',
  maintenance: 'maintenance',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export const JOBS = {
  sms: { send: 'send' },
  notifications: { receipt: 'receipt', reminder: 'reminder' },
  sessions: { generateDaily: 'generate-daily', generateGroup: 'generate-group', markAbsences: 'mark-absences' },
  outbox: { dispatch: 'dispatch' },
  maintenance: { expirePayments: 'expire-payments', subscriptionLifecycle: 'subscription-lifecycle', purgeIncomingDocs: 'purge-incoming-docs', purgeCallbackLogs: 'purge-callback-logs', refundReminders: 'refund-reminders' },
} as const

export interface SmsJobData {
  tenantId: string
  smsMessageId: string
  phoneE164: string
  templateKey: string
  lang: 'uz' | 'ru' | 'en'
  /** Encrypted with OTP_JOB_ENCRYPTION_KEY when the message carries a one-time code. */
  encryptedVars?: string
  vars?: Record<string, string>
}

export interface ReceiptJobData {
  tenantId: string
  paymentId: string
}

export interface ReminderJobData {
  tenantId: string
  sessionId: string
}

export interface GenerateDailyJobData {
  /** Local date (Asia/Tashkent) the run is for; the job id is derived from it. */
  forDate: string
}

export interface GenerateGroupJobData {
  tenantId: string
  groupId: string
  fromDate: string
  days: number
}

/** BullMQ job ids must not contain ':' when using custom ids with the default prefix separator; use '-'. */
export const jobId = (...parts: (string | number)[]) => parts.map((p) => String(p).replace(/[^\w.-]/g, '_')).join('-')
