type Props = { formula: string; className?: string };

export default function ChemicalFormula({ formula, className = '' }: Props) {
  const charge = formula.match(/([+-])(\d*)$/);
  const body = charge ? formula.slice(0, charge.index) : formula;
  const parts = body.split(/(\d+)/).filter(Boolean);
  return <span className={`chemical-formula ${className}`.trim()} aria-label={formula}>
    {parts.map((part, index) => /^\d+$/.test(part) ? <sub key={`${part}-${index}`}>{part}</sub> : part)}
    {charge && <sup>{charge[2]}{charge[1]}</sup>}
  </span>;
}
