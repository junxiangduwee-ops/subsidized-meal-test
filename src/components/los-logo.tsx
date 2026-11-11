type Size = 'sm' | 'md' | 'lg';

const config: Record<Size, { icon: string; title: string; gap: string }> = {
  sm: { icon: 'h-7 w-7',  title: 'text-sm font-bold',  gap: 'gap-2' },
  md: { icon: 'h-10 w-10', title: 'text-base font-bold', gap: 'gap-2.5' },
  lg: { icon: 'h-16 w-16', title: 'text-2xl font-bold', gap: 'gap-3' },
};

export function LOSLogo({ size = 'md', stacked = false }: { size?: Size; stacked?: boolean }) {
  const c = config[size];

  const icon = (
    <div className={`${c.icon} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 shadow-sm`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[58%] w-[58%]"
      >
        {/* Fork */}
        <path d="M7 2v4m0 0c0 1.1.9 2 2 2s2-.9 2-2V2M9 8v14" />
        {/* Knife */}
        <path d="M15 2c0 0 2 2.5 2 5s-2 3-2 3v12" />
      </svg>
    </div>
  );

  const text = (
    <div className={`${c.title} leading-tight tracking-tight text-slate-900`}>
      LOS
    </div>
  );

  return stacked ? (
    <div className={`flex flex-col items-center ${c.gap}`}>
      {icon}
      {text}
    </div>
  ) : (
    <div className={`flex items-center ${c.gap}`}>
      {icon}
      {text}
    </div>
  );
}
