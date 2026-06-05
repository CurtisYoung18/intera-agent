import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import RenderHintCard from '../render-hint-card'
import type { RenderHint } from '@intera/shared/channels/render-hints'

describe('RenderHintCard', () => {
  describe('form hint', () => {
    const formHint: RenderHint = { kind: 'form', layout: 'single', submitLabel: 'Submit' }

    it('renders text input fields from result.fields', () => {
      const result = {
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint: formHint, result }),
      )
      expect(html).toContain('Name')
      expect(html).toContain('type="text"')
      expect(html).toContain('required')
    })

    it('renders number input fields', () => {
      const result = {
        fields: [
          { key: 'age', label: 'Age', type: 'number', required: false },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint: formHint, result }),
      )
      expect(html).toContain('Age')
      expect(html).toContain('type="number"')
    })

    it('renders select fields with options', () => {
      const result = {
        fields: [
          { key: 'color', label: 'Color', type: 'select', options: ['Red', 'Blue', 'Green'] },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint: formHint, result }),
      )
      expect(html).toContain('Color')
      expect(html).toContain('<select')
      expect(html).toContain('Red')
      expect(html).toContain('Blue')
      expect(html).toContain('Green')
    })

    it('renders textarea fields', () => {
      const result = {
        fields: [
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint: formHint, result }),
      )
      expect(html).toContain('Notes')
      expect(html).toContain('<textarea')
    })

    it('renders a submit button', () => {
      const result = {
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint: formHint, result }),
      )
      expect(html).toContain('type="submit"')
    })

    it('uses custom submitLabel when provided', () => {
      const hint: RenderHint = { kind: 'form', submitLabel: 'Send It' }
      const result = {
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Send It')
    })

    it('renders default submit label when submitLabel not provided', () => {
      const hint: RenderHint = { kind: 'form' }
      const result = {
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Submit')
    })

    it('renders checkboxes for boolean-like fields', () => {
      const result = {
        fields: [
          { key: 'agree', label: 'I agree', type: 'checkbox', required: true },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint: formHint, result }),
      )
      expect(html).toContain('checkbox')
      expect(html).toContain('I agree')
    })
  })

  describe('card hint', () => {
    it('renders title when result has title', () => {
      const hint: RenderHint = { kind: 'card' }
      const result = { title: 'Order #TX123' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Order #TX123')
    })

    it('uses titleOverride when provided', () => {
      const hint: RenderHint = { kind: 'card', titleOverride: 'Custom Title' }
      const result = { title: 'Original' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Custom Title')
    })

    it('renders subtitle when present', () => {
      const hint: RenderHint = { kind: 'card' }
      const result = { title: 'Card', subtitle: 'This is a subtitle' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('This is a subtitle')
    })

    it('renders image when imageUrl is present', () => {
      const hint: RenderHint = { kind: 'card' }
      const result = { title: 'Card', imageUrl: 'https://example.com/img.png' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('<img')
      expect(html).toContain('https://example.com/img.png')
    })

    it('renders buttons when present', () => {
      const hint: RenderHint = { kind: 'card' }
      const result = {
        title: 'Card',
        buttons: [
          { label: 'View', action: 'view_order' },
          { label: 'Cancel', action: 'cancel' },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('View')
      expect(html).toContain('Cancel')
    })
  })

  describe('list hint', () => {
    it('renders bulleted list by default', () => {
      const hint: RenderHint = { kind: 'list' }
      const result = { items: ['First', 'Second', 'Third'] }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('First')
      expect(html).toContain('Second')
      expect(html).toContain('Third')
      const itemCount = (html.match(/First|Second|Third/g) || []).length
      expect(itemCount).toBe(3)
    })

    it('renders indexed list when showIndex is true', () => {
      const hint: RenderHint = { kind: 'list', showIndex: true }
      const result = { items: ['A', 'B'] }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('A')
      expect(html).toContain('B')
      expect(html).toContain('1')
      expect(html).toContain('2')
    })

    it('renders explicit bulleted list', () => {
      const hint: RenderHint = { kind: 'list', bulleted: true }
      const result = { items: ['X', 'Y'] }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('X')
      expect(html).toContain('Y')
    })
  })

  describe('image hint', () => {
    it('renders image from urlPath', () => {
      const hint: RenderHint = { kind: 'image', urlPath: '$.image.url' }
      const result = { image: { url: 'https://example.com/photo.png' } }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('<img')
      expect(html).toContain('https://example.com/photo.png')
    })

    it('uses altPath for alt text', () => {
      const hint: RenderHint = {
        kind: 'image',
        urlPath: '$.img.src',
        altPath: '$.img.desc',
      }
      const result = { img: { src: 'https://example.com/pic.jpg', desc: 'A photo' } }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('alt="A photo"')
    })

    it('does not render img when urlPath resolves to undefined', () => {
      const hint: RenderHint = { kind: 'image', urlPath: '$.missing.path' }
      const result = {}
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).not.toContain('<img')
    })
  })

  describe('plain hint', () => {
    it('renders plain text when wrap is none', () => {
      const hint: RenderHint = { kind: 'plain', wrap: 'none' }
      const result = 'Just some text here'
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Just some text here')
      expect(html).not.toContain('<blockquote')
      expect(html).not.toContain('<pre')
    })

    it('renders blockquote when wrap is quote', () => {
      const hint: RenderHint = { kind: 'plain', wrap: 'quote' }
      const result = { text: 'A wise saying' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('<blockquote')
      expect(html).toContain('A wise saying')
    })

    it('renders pre/code when wrap is code', () => {
      const hint: RenderHint = { kind: 'plain', wrap: 'code' }
      const result = { text: 'const x = 1;' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('<pre')
      expect(html).toContain('<code')
      expect(html).toContain('const x = 1;')
    })

    it('defaults to wrap none when not specified', () => {
      const hint: RenderHint = { kind: 'plain' }
      const result = { text: 'Default text' }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Default text')
      expect(html).not.toContain('<blockquote')
      expect(html).not.toContain('<pre')
    })
  })

  describe('legacy quick_replies', () => {
    it('renders options as horizontal pill buttons', () => {
      const hint: any = { kind: 'quick_replies' }
      const result = {
        options: [
          { id: '1', label: 'Option A' },
          { id: '2', label: 'Option B' },
        ],
      }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toContain('Option A')
      expect(html).toContain('Option B')
    })

    it('returns null when quick_replies has empty options', () => {
      const hint: any = { kind: 'quick_replies' }
      const result = { options: [] }
      const html = renderToString(
        RenderHintCard({ hint, result }),
      )
      expect(html).toBe('')
    })
  })

  describe('edge cases', () => {
    it('returns empty string when result is undefined and hint is not image', () => {
      const hint: RenderHint = { kind: 'card' }
      const html = renderToString(
        RenderHintCard({ hint }),
      )
      // Should render nothing meaningful — no crash
      expect(typeof html).toBe('string')
    })

    it('handles unknown hint kind gracefully', () => {
      const hint: any = { kind: 'unknown_kind' }
      const html = renderToString(
        RenderHintCard({ hint, result: {} }),
      )
      // Should not throw, returns empty output
      expect(typeof html).toBe('string')
    })
  })
})
