/**
 * Chart Wrapper — Thin abstraction over Chart.js for leave analytics.
 *
 * Usage:
 *   import { createLineChart, createBarChart, createDoughnutChart } from './components/chart-wrapper.js';
 *
 *   createLineChart({
 *       el: '#monthly-trends',
 *       labels: ['Jan', 'Feb', 'Mar', ...],
 *       datasets: [
 *           { label: 'VL', data: [3, 5, 2, ...], color: '#1565c0' },
 *           { label: 'SL', data: [1, 2, 3, ...], color: '#c62828' },
 *       ],
 *       title: 'Monthly Leave Trends',
 *   });
 */

// Default palette
const COLORS = {
    blue:    '#1565c0',
    red:     '#c62828',
    green:   '#2e7d32',
    orange:  '#e65100',
    purple:  '#6a1b9a',
    teal:    '#00838f',
    amber:   '#ff8f00',
    indigo:  '#283593',
    pink:    '#ad1457',
    gray:    '#546e7a',
};

const COLOR_LIST = Object.values(COLORS);

/**
 * Base chart defaults shared across all chart types.
 */
function getBaseOptions(title) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            title: {
                display: !!title,
                text: title || '',
                font: { size: 14, weight: '600' },
                color: '#212121',
                padding: { bottom: 12 },
            },
            tooltip: {
                backgroundColor: '#212121',
                titleFont: { size: 12 },
                bodyFont: { size: 12 },
                cornerRadius: 8,
                padding: 10,
                displayColors: true,
                boxPadding: 4,
            },
        },
    };
}

/**
 * Create a line chart (monthly trends, time series).
 */
export function createLineChart(config) {
    const canvas = resolveCanvas(config.el);
    if (!canvas) return null;

    const datasets = (config.datasets || []).map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color || COLOR_LIST[i % COLOR_LIST.length],
        backgroundColor: (ds.color || COLOR_LIST[i % COLOR_LIST.length]) + '15',
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: ds.color || COLOR_LIST[i % COLOR_LIST.length],
        tension: 0.3,
        fill: ds.fill !== undefined ? ds.fill : true,
    }));

    const options = {
        ...getBaseOptions(config.title),
        scales: {
            x: {
                grid: { display: false },
                ticks: { font: { size: 11 }, color: '#9e9e9e' },
            },
            y: {
                beginAtZero: true,
                grid: { color: '#f0f0f0' },
                ticks: { font: { size: 11 }, color: '#9e9e9e' },
            },
        },
        interaction: {
            mode: 'index',
            intersect: false,
        },
    };

    return new Chart(canvas, {
        type: 'line',
        data: { labels: config.labels || [], datasets },
        options,
    });
}

/**
 * Create a bar chart (leave type breakdown, per-office, etc.).
 * Supports hover dimming effect.
 */
export function createBarChart(config) {
    const canvas = resolveCanvas(config.el);
    if (!canvas) return null;

    const datasets = (config.datasets || []).map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.colors || ds.color || COLOR_LIST[i % COLOR_LIST.length],
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: config.horizontal ? undefined : 40,
    }));

    const options = {
        ...getBaseOptions(config.title),
        indexAxis: config.horizontal ? 'y' : 'x',
        scales: {
            x: {
                grid: { display: config.horizontal },
                ticks: { font: { size: 11 }, color: '#9e9e9e' },
            },
            y: {
                beginAtZero: true,
                grid: { display: !config.horizontal, color: '#f0f0f0' },
                ticks: { font: { size: 11 }, color: '#9e9e9e' },
            },
        },
        // Dim other bars on hover
        onHover: (evt, elements, chart) => {
            if (!config.dimOnHover) return;
            const ds = chart.data.datasets[0];
            if (!ds) return;
            if (elements.length > 0) {
                const idx = elements[0].index;
                ds.backgroundColor = ds.data.map((_, i) =>
                    i === idx ? (ds._originalColors?.[i] || COLOR_LIST[0]) : (ds._originalColors?.[i] || COLOR_LIST[0]) + '30'
                );
            } else {
                ds.backgroundColor = ds._originalColors || ds.backgroundColor;
            }
            chart.update('none');
        },
    };

    const chart = new Chart(canvas, {
        type: 'bar',
        data: { labels: config.labels || [], datasets },
        options,
    });

    // Store original colors for dimming
    if (config.dimOnHover && chart.data.datasets[0]) {
        chart.data.datasets[0]._originalColors = Array.isArray(chart.data.datasets[0].backgroundColor)
            ? [...chart.data.datasets[0].backgroundColor]
            : chart.data.datasets[0].data.map(() => chart.data.datasets[0].backgroundColor);
    }

    return chart;
}

/**
 * Create a doughnut chart (balance overview).
 * Visual design follows the shadcn/ui ChartContainer + ChartTooltipContent +
 * ChartLegendContent pattern: light tooltip with border/shadow, centered legend
 * with 8×8 px rounded-square (2 px radius) color indicators.
 */
export function createDoughnutChart(config) {
    const canvas = resolveCanvas(config.el);
    if (!canvas) return null;

    const colors = config.colors || (config.data || []).map((_, i) => COLOR_LIST[i % COLOR_LIST.length]);
    const labels  = config.labels || [];

    // ── Legend injection ──────────────────────────────────────────────────────
    // Walk up to .chart-card-body so the legend can sit below the chart ring.
    const cardBody = canvas.closest('.chart-card-body');
    if (cardBody) {
        // Switch body to column so the legend stacks below the doughnut wrapper.
        cardBody.style.flexDirection = 'column';
        cardBody.style.alignItems    = 'center';
        // Remove stale legend from a previous render before re-injecting.
        const stale = cardBody.querySelector('.pie-chart-legend');
        if (stale) stale.remove();
        // Build legend matching ChartLegendContent style.
        if (labels.length > 0) {
            const legendEl = document.createElement('div');
            legendEl.className = 'pie-chart-legend';
            legendEl.innerHTML = labels.map((label, i) =>
                `<div class="pie-chart-legend-item">` +
                `<span class="pie-chart-legend-dot" style="background:${colors[i % colors.length]}"></span>` +
                `<span>${label}</span>` +
                `</div>`
            ).join('');
            cardBody.appendChild(legendEl);
        }
    }

    // ── Chart options ─────────────────────────────────────────────────────────
    const options = {
        ...getBaseOptions(config.title),
        cutout: config.cutout || '70%',
        // Entry animation: segments sweep in and scale up from the centre,
        // matching Recharts' default pie entry animation in the shadcn design.
        animation: {
            animateRotate: true,   // arc sweep from 0 → full angle
            animateScale:  true,   // ring scales from 0 → full radius
            duration:      700,    // ms — snappy but visible
            easing:        'easeInOutQuart',
        },
        // Hover transition: smooth arc expansion when a segment is hovered.
        transitions: {
            active: {
                animation: {
                    duration: 200,
                    easing:   'easeOutQuart',
                },
            },
        },
        plugins: {
            ...getBaseOptions(config.title).plugins,
            legend: { display: false },
            // Light tooltip matching ChartTooltipContent: white bg, subtle border,
            // xs text, label left / value right, 8×8 rounded-square color swatch.
            tooltip: {
                backgroundColor: '#ffffff',
                titleColor:       '#111827',
                bodyColor:        '#6b7280',
                borderColor:      'rgba(0,0,0,0.08)',
                borderWidth:      1,
                cornerRadius:     8,
                padding:          10,
                boxPadding:       4,
                boxWidth:         8,
                boxHeight:        8,
                displayColors:    true,
                callbacks: {
                    label: (ctx) => {
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                        return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                    },
                },
            },
        },
    };

    return new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data:            config.data || [],
                backgroundColor: colors,
                borderWidth:     0,
                hoverOffset:     10,   // visible lift on hover
            }],
        },
        options,
    });
}

/**
 * Resolve a canvas element from a selector or element reference.
 */
function resolveCanvas(el) {
    if (typeof el === 'string') {
        const container = document.querySelector(el);
        if (!container) {
            console.error('[ChartWrapper] Container not found:', el);
            return null;
        }
        // If it's a canvas, use directly
        if (container.tagName === 'CANVAS') return container;
        // Otherwise, create a canvas inside it
        let canvas = container.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            container.appendChild(canvas);
        }
        return canvas;
    }
    return el;
}

/**
 * Destroy a chart instance safely.
 */
export function destroyChart(chart) {
    if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
    }
}

// Expose globally
if (typeof window !== 'undefined') {
    window.ChartWrapper = { createLineChart, createBarChart, createDoughnutChart, destroyChart };
}
