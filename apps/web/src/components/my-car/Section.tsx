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
  id,
  title,
  action,
  children,
}: {
  /** Anchor for the at-a-glance tiles to scroll to. `scroll-mt` keeps it clear of the top edge. */
  id?: string;
  title: string;
  /**
   * The one thing you can DO to this section, sitting on the heading rule at the right --
   * "Add an upkeep job", "Log a service".
   *
   * Up here rather than under the list because its position should not depend on how long the
   * list is. Trailing the rows, the button lands in a different place on every car and moves
   * further down the page as the history grows, so it has to be hunted for; on the rule it is
   * always exactly where the section starts.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      {/* `items-end` so the button sits ON the rule with the heading's baseline, rather than
          centred against a heading that is taller than it. `min-h` keeps the rule in the same
          place whether or not a section has an action. */}
      <div className="flex min-h-9 items-end justify-between gap-4 border-b pb-2">
        <h2 className="text-body-lg font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
