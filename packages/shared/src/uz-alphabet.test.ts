import { describe, expect, it } from 'vitest'
import { dict } from './translations.js'
import * as sample from './sample-data.js'
import { ONLINE_CATEGORIES, ONLINE_COURSES } from './online-courses.js'
import { ilmoraUz, pickDisplay } from './uz-alphabet.js'
import { pick } from './i18n.js'

describe('ilmoraUz: stored Uzbek text shown in the ILMORA alphabet', () => {
  it('turns o‘ g‘ sh ch into Ö Ğ Ş Ç, whichever apostrophe was typed', () => {
    expect(ilmoraUz("Shaxmat 5–7 yosh · oflayn — Boshlang'ich")).toBe('Şaxmat 5–7 yoş · oflayn — Boşlanğiç')
    expect(ilmoraUz('Oʻzbekiston, oʻquv markazi, togʻ')).toBe('Özbekiston, öquv markazi, toğ')
    expect(ilmoraUz('O‘rta daraja; g`oya; mashg´ulot')).toBe('Örta daraja; ğoya; maşğulot')
    expect(ilmoraUz('Mening to’plamim')).toBe('Mening töplamim')
    expect(ilmoraUz('tosh-qaychi-qog\'oz o\'yini')).toBe('toş-qayçi-qoğoz öyini')
    expect(ilmoraUz('CHORSHANBA, SHANBA')).toBe('ÇORŞANBA, ŞANBA')
  })

  it('writes the tutuq as ’ and leaves it where it is', () => {
    expect(ilmoraUz("sun'iy intellekt, ta'lim, e'tibor")).toBe('sun’iy intellekt, ta’lim, e’tibor')
    expect(ilmoraUz('maʼlumot va masʼuliyat')).toBe('ma’lumot va mas’uliyat')
  })

  it('keeps English words and names: those in the English version, product names, English-looking words', () => {
    const en = 'Timedoor Academy program for kids aged 5–7. Children use ScratchJr and Scratch 3.0 and build games in Roblox Studio. Coach: Olimjon Toshev.'
    expect(ilmoraUz("Timedoor Academy dasturi 5–7 yoshli bolalar uchun. ScratchJr va Scratch 3.0, Roblox Studio'da o'yinlar. Ustoz: Olimjon Toshev.", en))
      .toBe('Timedoor Academy dasturi 5–7 yoşli bolalar uçun. ScratchJr va Scratch 3.0, Roblox Studio’da öyinlar. Ustoz: Olimjon Toshev.')
    expect(ilmoraUz('ChatGPT, GitHub va JavaScript bilan ishlash')).toBe('ChatGPT, GitHub va JavaScript bilan işlaş')
    expect(ilmoraUz('Speaking, Teacher, School, Workshop, Research — ingliz tilida')).toBe('Speaking, Teacher, School, Workshop, Research — ingliz tilida')
    expect(ilmoraUz('IELTS Speaking sharhi', 'IELTS Speaking review')).toBe('IELTS Speaking şarhi')
  })

  it('never touches links, e-mail addresses, placeholders or a text that is the same in English', () => {
    expect(ilmoraUz('Sayt: https://shaxmat.uz/boshlash va info@chess-school.uz, {child} uchun')).toBe('Sayt: https://shaxmat.uz/boshlash va info@chess-school.uz, {child} uçun')
    expect(ilmoraUz('CS50’s Introduction to Computer Science', 'CS50’s Introduction to Computer Science')).toBe('CS50’s Introduction to Computer Science')
  })

  it('changes nothing that is already in the ILMORA alphabet: the whole interface and the seeded content', () => {
    for (const [key, v] of Object.entries(dict)) expect(ilmoraUz(v.uz, v.en), key).toBe(v.uz)
    const walk = (path: string, o: unknown) => {
      if (!o || typeof o !== 'object') return
      const r = o as Record<string, unknown>
      if (typeof r.uz === 'string' && typeof r.en === 'string') return void expect(ilmoraUz(r.uz, r.en), path).toBe(r.uz)
      for (const [k, v] of Object.entries(r)) walk(`${path}.${k}`, v)
    }
    walk('sample', sample)
    walk('online', { ONLINE_CATEGORIES, ONLINE_COURSES })
  })

  it('is stable: converting twice gives the same text', () => {
    const once = ilmoraUz("Bosqichma-bosqich o'rgatadi; mashg'ulotlar Toshkentda, Chilonzor tumanida")
    expect(once).toBe('Bosqiçma-bosqiç örgatadi; maşğulotlar Toşkentda, Çilonzor tumanida')
    expect(ilmoraUz(once)).toBe(once)
  })
})

describe('pickDisplay', () => {
  const title = { uz: "Onlayn shaxmat — O'rta daraja", ru: 'Онлайн-шахматы — средний уровень', en: 'Online chess — intermediate' }
  it('shows Uzbek in the ILMORA alphabet and leaves the other languages and the stored value alone', () => {
    expect(pickDisplay('uz', title)).toBe('Onlayn şaxmat — Örta daraja')
    expect(pickDisplay('ru', title)).toBe(title.ru)
    expect(pickDisplay('en', title)).toBe(title.en)
    expect(pick('uz', title)).toBe(title.uz)
    expect(title.uz).toBe("Onlayn shaxmat — O'rta daraja")
  })
  it('falls back like pick when there is no Uzbek text', () => {
    expect(pickDisplay('uz', { uz: '', ru: 'Курс', en: 'Course' })).toBe('Course')
    expect(pickDisplay('uz', null)).toBe('')
  })
})
