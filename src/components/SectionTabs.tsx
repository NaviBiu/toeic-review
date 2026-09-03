'use client';

type TabOption<T extends string> = {
  value: T;
  label: string;
};

export default function SectionTabs<T extends string>({
  value,
  options,
  onChange,
  label = '内容分类',
}: {
  value: T;
  options: TabOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid overflow-hidden rounded-md border border-stone-300 bg-white p-1 shadow-sm"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`min-h-10 rounded-md px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-1 ${
              selected
                ? 'bg-stone-900 text-white'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
