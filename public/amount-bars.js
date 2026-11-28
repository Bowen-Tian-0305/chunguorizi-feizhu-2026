export function amountBar(value, maximum) {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum < 0) return '';
  const width = maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0;
  return `<span class="amount-track" aria-hidden="true"><span data-amount-fill style="--amount-width:${width.toFixed(2)}%"></span></span>`;
}

export function updateAmountMarkup(container, markup) {
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const previousBars = motion ? [...container.querySelectorAll('[data-amount-fill]')].map(bar => ({
    width: bar.offsetWidth / bar.parentElement.clientWidth * 100,
    target: bar.style.getPropertyValue('--amount-width')
  })) : [];
  const previousAmounts = motion ? [...container.querySelectorAll('[data-amount-highlight]')].map(node => node.textContent) : [];
  container.innerHTML = markup;
  if (!motion) return;

  const transitions = [];
  container.querySelectorAll('[data-amount-fill]').forEach((bar, index) => {
    const previous = previousBars[index];
    const target = bar.style.getPropertyValue('--amount-width');
    if (!previous || previous.target === target || !Number.isFinite(previous.width)) return;
    bar.style.setProperty('--amount-width', previous.width + '%');
    transitions.push([bar, target]);
  });
  if (transitions.length) {
    container.getBoundingClientRect();
    transitions.forEach(([bar, target]) => bar.style.setProperty('--amount-width', target));
  }
  container.querySelectorAll('[data-amount-highlight]').forEach((node, index) => {
    if (previousAmounts[index] !== undefined && previousAmounts[index] !== node.textContent) node.classList.add('amount-updated');
  });
}
