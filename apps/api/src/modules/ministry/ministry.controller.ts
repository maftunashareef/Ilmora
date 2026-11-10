import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { L } from '@ilmora/shared'
import type { Response } from 'express'
import { Roles } from '../../common/decorators'
import { buildXlsx, type Cell } from '../../common/xlsx'
import { ZodValidationPipe } from '../../common/zod.pipe'
import { AuditService } from '../audit/audit.service'
import { MinistryRegistryService } from './ministry-registry.service'
import { MinistryStatsService } from './ministry-stats.service'
import { ExportQuery, MinistryCompaniesQuery, MinistryInstitutionsQuery, StatsQuery } from './ministry.schemas'

const isL = (v: unknown): v is L => !!v && typeof v === 'object' && 'ru' in (v as object)

/**
 * The ministry's workspace (ТЗ 7): the registry (read-only) and the figures with an Excel download of any table.
 * MINISTRY signs in with the authenticator code; the Super Admin sees the same. Counts only — no personal data.
 */
@Controller('ministry')
@Roles('MINISTRY')
export class MinistryController {
  constructor(private readonly stats: MinistryStatsService, private readonly registry: MinistryRegistryService, private readonly audit: AuditService) {}

  @Get('stats') all(@Query(new ZodValidationPipe(StatsQuery)) q: StatsQuery) { return this.stats.all(q) }

  /** Any table as .xlsx in the chosen language; every download is audited (ТЗ 8). */
  @Get('export')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async export(@Query(new ZodValidationPipe(ExportQuery)) q: ExportQuery, @Res() res: Response) {
    const { table, lang, ...filters } = q
    const t = await this.stats.one(table, filters)
    const header = t.columns.map((c) => c.label[lang])
    const rows: Cell[][] = t.rows.map((r) => t.columns.map((c) => { const v = r[c.key]; return isL(v) ? v[lang] : (v as Cell) }))
    const file = buildXlsx(t.title[lang], header, rows)
    await this.audit.record({ action: 'ministry.export', entityType: 'StatsTable', entityId: table, after: { filters, lang, rows: rows.length } })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="ilmora-${table}-${new Date().toISOString().slice(0, 10)}.xlsx"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(file)
  }

  @Get('institutions') institutions(@Query(new ZodValidationPipe(MinistryInstitutionsQuery)) q: MinistryInstitutionsQuery) { return this.registry.institutionsPage(q) }
  @Get('institutions/:id') institution(@Param('id') id: string) { return this.registry.institution(id) }
  @Get('companies') companies(@Query(new ZodValidationPipe(MinistryCompaniesQuery)) q: MinistryCompaniesQuery) { return this.registry.companiesPage(q) }
}
