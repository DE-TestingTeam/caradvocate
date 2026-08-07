/**
 * A titled block of the car page: heading, rule, content.
 *
 * This replaced CollapsibleSection on My Car. The accordions defaulted to open and were rarely
 * closed, so the chevrons were mostly decoration -- and collapsing is actively wrong for this
 * page, where the point is to take in recalls, upkeep and known issues at a glance rather than
 * to open them one at a time. A rule under a heading separates just as well as a fold and costs
 * no interaction.
 *
 * The heading is deliberately much smaller than the car's name. There is one h1 on this page and
 * it is the vehicle; these are signposts within it.
 */
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="border-b pb-2 text-body-lg font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The label above one column inside a Section -- "Open recalls" next to "Scheduled maintenance".
 * Uppercase micro-type, matching the eyebrows used elsewhere in the app, so a column label is
 * never mistaken for a section heading.
 */
export function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-label font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </h3>
  );
}
