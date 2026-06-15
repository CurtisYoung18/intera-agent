import { describe, expect, it } from 'vitest'
import {
  detectWidgetLocale,
  getWidgetCopy,
  isWidgetPreview,
  parseWidgetFields,
  readWidgetSearchParam,
} from '../../form-widget'

describe('livechat form widget helpers', () => {
  it('parses field payloads using either key or id', () => {
    const fields = parseWidgetFields(JSON.stringify([
      { key: 'member_id', type: 'text', label: 'Member ID', required: true },
      { id: 'amount', type: 'number', label: 'Amount' },
      { type: 'text', label: 'Missing key' },
    ]))

    expect(fields).toEqual([
      { key: 'member_id', type: 'text', label: 'Member ID', required: true, options: undefined, placeholder: undefined },
      { key: 'amount', type: 'number', label: 'Amount', required: false, options: undefined, placeholder: undefined },
    ])
  })

  it('detects chinese copy from field labels', () => {
    const locale = detectWidgetLocale({
      title: '查询最近一次存款详情',
      fields: [{ label: '存款金额', placeholder: '例如：800' }],
    })

    expect(locale).toBe('zh')
    expect(getWidgetCopy(locale).openForm).toBe('填写信息')
  })

  it('reads single-value params and preview flag', () => {
    const params = {
      title: ['Deposit details'],
      preview: '1',
    }

    expect(readWidgetSearchParam(params, 'title')).toBe('Deposit details')
    expect(isWidgetPreview(params)).toBe(true)
  })
})
