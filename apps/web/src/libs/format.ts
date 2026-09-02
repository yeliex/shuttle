export function initials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || '?';
}

export function formatDate(value: string): string {
    return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
    const elapsed = new Date(value).getTime() - Date.now();
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
    ];
    const [unit, divisor] = units.find(([, size]) => Math.abs(elapsed) >= size) ?? ['minute', 60_000];
    const amount = Math.round(elapsed / divisor);
    return new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(amount, unit);
}

export function safeRedirect(value: string | null): string | undefined {
    return value?.startsWith('/') && !value.startsWith('//') ? value : undefined;
}
