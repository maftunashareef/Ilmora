import { describe, expect, it, vi } from 'vitest'
import { ValidationPipe } from '@nestjs/common'
import { CatalogController, InquiryDto } from '../src/modules/catalog/catalog.controller'

describe('Inquiry endpoint and validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
  })

  it('validates and accepts payload with all center application fields', async () => {
    const payload = {
      centerName: 'Ilm Markazi',
      district: 'Yunusobod tumani',
      contactName: 'Maftuna Karimova',
      phone: '+998 97 541 41 41',
      telegram: '@ilm_markazi',
      courses: 'IELTS, Matematika',
      message: 'Biz platformaga ulanmoqchimiz',
      consent: true,
    }

    const transformed = (await pipe.transform(payload, {
      type: 'body',
      metatype: InquiryDto,
    })) as InquiryDto

    expect(transformed.centerName).toBe('Ilm Markazi')
    expect(transformed.district).toBe('Yunusobod tumani')
    expect(transformed.contactName).toBe('Maftuna Karimova')
    expect(transformed.phone).toBe('+998 97 541 41 41')
    expect(transformed.telegram).toBe('@ilm_markazi')
    expect(transformed.courses).toBe('IELTS, Matematika')
  })

  it('accepts center and contact aliases for backwards compatibility', async () => {
    const payload = {
      center: 'Ilm Markazi',
      contact: 'Maftuna Karimova',
      phone: '97 541 41 41',
    }

    const transformed = (await pipe.transform(payload, {
      type: 'body',
      metatype: InquiryDto,
    })) as InquiryDto

    expect(transformed.center).toBe('Ilm Markazi')
    expect(transformed.contact).toBe('Maftuna Karimova')
  })

  it('saves application with structured message and normalized phone in database', async () => {
    const createdRows: any[] = []
    const mockPrisma = {
      client: {
        centerInquiry: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }) => {
            const row = { id: 'inq-99', createdAt: new Date('2026-10-23T00:30:00Z'), ...data }
            createdRows.push(row)
            return row
          }),
        },
      },
    }

    const controller = new CatalogController({} as any, {} as any, mockPrisma as any)

    const result = await controller.inquiry('tenant-ilmora', {
      centerName: 'Ilm Markazi',
      district: 'Yunusobod tumani',
      contactName: 'Maftuna Karimova',
      phone: '+998 97 541 41 41',
      telegram: '@ilm_markazi',
      courses: 'IELTS, SAT',
      message: 'Katta auditoriyaga egamiz',
      consent: true,
    })

    expect(result).toEqual({ id: 'inq-99', receivedAt: expect.any(Date) })
    expect(createdRows[0].phoneE164).toBe('+998975414141')
    expect(createdRows[0].centerName).toBe('Ilm Markazi')
    expect(createdRows[0].contactName).toBe('Maftuna Karimova')
    expect(createdRows[0].message).toContain('District: Yunusobod tumani')
    expect(createdRows[0].message).toContain('Telegram: @ilm_markazi')
    expect(createdRows[0].message).toContain('Courses: IELTS, SAT')
    expect(createdRows[0].message).toContain('Katta auditoriyaga egamiz')
  })

  it('prevents accidental duplicate submissions within 5 minutes', async () => {
    const existing = { id: 'inq-already-saved', createdAt: new Date('2026-10-23T00:28:00Z') }
    const mockPrisma = {
      client: {
        centerInquiry: {
          findFirst: vi.fn().mockResolvedValue(existing),
          create: vi.fn(),
        },
      },
    }

    const controller = new CatalogController({} as any, {} as any, mockPrisma as any)

    const result = await controller.inquiry('tenant-ilmora', {
      centerName: 'Ilm Markazi',
      contactName: 'Maftuna Karimova',
      phone: '+998 97 541 41 41',
    })

    expect(result).toEqual({ id: 'inq-already-saved', receivedAt: existing.createdAt })
    expect(mockPrisma.client.centerInquiry.create).not.toHaveBeenCalled()
  })

  it('rejects invalid phone numbers with invalid_phone error', async () => {
    const mockPrisma = { client: { centerInquiry: { findFirst: vi.fn(), create: vi.fn() } } }
    const controller = new CatalogController({} as any, {} as any, mockPrisma as any)

    await expect(
      controller.inquiry('tenant-ilmora', {
        centerName: 'Ilm Markazi',
        contactName: 'Maftuna',
        phone: '12345',
      }),
    ).rejects.toMatchObject({ code: 'invalid_phone' })
  })
})
