import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriceRangeBar } from "./PriceRangeBar";
import { formatCurrency } from "@/lib/format";
import type { Assessment } from "@caradvocate/shared";

export function PartsBenchmarkCard({ assessment }: { assessment: Assessment }) {
  const { parts } = assessment;

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <Accordion type="single" collapsible defaultValue="parts">
          <AccordionItem value="parts">
            <AccordionTrigger className="border-b-0 pt-0">
              Parts Price Benchmark
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  Detailed parts breakdown
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>Part Name</TableHead>
                        <TableHead className="text-right">Avg Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parts.items.map((part) => (
                        <TableRow key={part.name}>
                          <TableCell className="text-muted-foreground">
                            {part.name}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(part.avgPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <p className="text-sm font-semibold">
                Total Parts Estimate: {formatCurrency(parts.total)}
              </p>

              <PriceRangeBar
                low={parts.low}
                avg={parts.total}
                high={parts.high}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
