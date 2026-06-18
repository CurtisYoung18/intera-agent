export type WidgetLocale = 'zh' | 'en'

export type WidgetFormFieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'textarea'
  | 'date'
  | 'file'

export interface WidgetFormField {
  key: string
  type: WidgetFormFieldType
  label: string
  required: boolean
  options?: string[]
  placeholder?: string
  validation?: {
    dateRange?: {
      pairId?: string
      role: 'start' | 'end'
    }
  }
}

const SUPPORTED_WIDGET_FIELD_TYPES = new Set<WidgetFormFieldType>([
  'text',
  'number',
  'select',
  'textarea',
  'date',
  'file',
])

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

function normalizeField(input: unknown): WidgetFormField | null {
  if (!input || typeof input !== 'object') return null

  const candidate = input as Record<string, unknown>
  const rawKey = typeof candidate.key === 'string'
    ? candidate.key
    : typeof candidate.id === 'string'
      ? candidate.id
      : ''
  const key = rawKey.trim()
  if (!key) return null

  const label = typeof candidate.label === 'string' && candidate.label.trim()
    ? candidate.label.trim()
    : key

  const rawType = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : 'text'
  const type = SUPPORTED_WIDGET_FIELD_TYPES.has(rawType as WidgetFormFieldType)
    ? rawType as WidgetFormFieldType
    : 'text'

  const options = Array.isArray(candidate.options)
    ? candidate.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
    : undefined
  const validation = normalizeFieldValidation(candidate.validation)

  return {
    key,
    type,
    label,
    required: Boolean(candidate.required),
    options,
    placeholder: typeof candidate.placeholder === 'string' && candidate.placeholder.trim().length > 0
      ? candidate.placeholder
      : undefined,
    ...(validation ? { validation } : {}),
  }
}

function normalizeFieldValidation(value: unknown): WidgetFormField['validation'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const dateRange = record.dateRange
  if (!dateRange || typeof dateRange !== 'object' || Array.isArray(dateRange)) return undefined
  const range = dateRange as Record<string, unknown>
  const role = range.role === 'start' || range.role === 'end' ? range.role : undefined
  if (!role) return undefined
  const pairId = typeof range.pairId === 'string' && range.pairId.trim()
    ? range.pairId.trim()
    : undefined
  return {
    dateRange: {
      ...(pairId ? { pairId } : {}),
      role,
    },
  }
}

export function parseWidgetFields(raw: string | string[] | undefined): WidgetFormField[] {
  const serialized = firstString(raw)
  if (!serialized) return []

  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeField).filter((field): field is WidgetFormField => Boolean(field))
  } catch {
    return []
  }
}

export function detectWidgetLocale(input: {
  title?: string
  description?: string
  fields?: Array<Pick<WidgetFormField, 'label' | 'placeholder'>>
}): WidgetLocale {
  const blob = [
    input.title,
    input.description,
    ...(input.fields ?? []).flatMap((field) => [field.label, field.placeholder]),
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')

  return CJK_RE.test(blob) ? 'zh' : 'en'
}

export function readWidgetSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  return firstString(params[key]) ?? ''
}

export function isWidgetPreview(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return readWidgetSearchParam(params, 'preview') === '1'
}

export function getWidgetCopy(locale: WidgetLocale) {
  if (locale === 'zh') {
    return {
      fallbackTitle: '需要补充信息',
      fallbackDescription: '请填写下列表单，提交后我会继续为您处理。',
      formBadge: '信息表单',
      openForm: '填写信息',
      submit: '提交',
      submitting: '提交中...',
      closeHint: '提交后会尝试自动返回聊天窗口；若未自动关闭，可手动返回继续对话。',
      submittedTitle: '已提交',
      submittedDescription: '信息已发回当前会话，系统会尝试自动返回聊天窗口。',
      previewBadge: '预览模式',
      previewDescription: '这里展示的是 runtime / LLM 当前要求采集的动态字段。',
      noFields: '当前没有可渲染的字段。',
      fileFieldHint: '文件字段暂不直接走表单上传；如需提交图片或文件，请回到聊天窗口直接发送。',
      missingChat: '当前缺少 chatId，无法把表单结果提交回会话。',
      submitFailed: '提交失败，请稍后重试。',
      requiredMark: '必填',
    }
  }

  return {
    fallbackTitle: 'Information required',
    fallbackDescription: 'Fill in the requested details and I will continue from there.',
    formBadge: 'Information form',
    openForm: 'Fill details',
    submit: 'Submit',
    submitting: 'Submitting...',
    closeHint: 'After submitting, the widget will try to return to the chat automatically. If it stays open, you can go back manually.',
    submittedTitle: 'Submitted',
    submittedDescription: 'The answers were sent back to the active chat and the widget will try to return you there automatically.',
    previewBadge: 'Preview mode',
    previewDescription: 'This form is generated from the runtime / LLM field request for the current step.',
    noFields: 'There are no renderable fields in this request.',
    fileFieldHint: 'File fields are not wired into form uploads yet. Please send the image or file directly in chat.',
    missingChat: 'Missing chatId, so this form cannot submit back to the conversation.',
    submitFailed: 'Unable to submit right now. Please try again.',
    requiredMark: 'Required',
  }
}
