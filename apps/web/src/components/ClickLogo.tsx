import { cx } from './ui/helpers'

/**
 * Click, named on the same light plate as Payme's logo. The provider's own logo file is not in /public/brand yet: until
 * it is, the name is written out.
 */
export function ClickLogo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center rounded-control bg-paper px-3.5 py-2 shadow-soft', className)}>
      <span className="text-lg font-semibold leading-[30px] tracking-tight text-[#0b6bd3]">Click</span>
    </span>
  )
}
