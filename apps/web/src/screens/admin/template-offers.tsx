import {
  getListStudyTemplatesQueryKey,
  getListTemplateOffersQueryKey,
  type TemplateOffer,
  useAcceptTemplateOffer,
  useDeclineTemplateOffer,
  useListTemplateOffers,
} from "@parfocal/api-client";
import { NameCell } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { type Notify, tableClass } from "./common.tsx";
import { kindLabel, problemTitle } from "./template-model.ts";

export function TemplateOffers({ notify }: { notify: Notify }) {
  const offers = okData(useListTemplateOffers().data) ?? [];
  const queryClient = useQueryClient();
  const person = usePeople();
  const accept = useAcceptTemplateOffer();
  const decline = useDeclineTemplateOffer();
  if (offers.length === 0) return null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListTemplateOffersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListStudyTemplatesQueryKey() });
  };
  const decide = (offer: TemplateOffer, accepting: boolean) => {
    const run = accepting ? accept : decline;
    run.mutate(
      { offerId: offer.id },
      {
        onError: () => notify("That did not work. Try again."),
        onSuccess: (response) => {
          if (response.status >= 300) {
            notify(problemTitle(response.data));
            return;
          }
          refresh();
          notify(
            accepting
              ? `${offer.name} is now in the library`
              : `${offer.name} was declined and is not in the library`,
          );
        },
      },
    );
  };
  return (
    <Zone
      title="Offered by researchers"
      sub="A researcher arranged a report and offered the layout to the library. Accept adds it as a template, decline leaves the library as it is."
    >
      <Table className={tableClass} aria-label="Offered report layouts">
        <TableHeader>
          <TableRow>
            <TableHead>Layout</TableHead>
            <TableHead>Offered by</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {offers.map((offer) => (
            <TableRow key={offer.id}>
              <TableCell>
                <NameCell
                  lead={<Icon name="file" />}
                  title={offer.name}
                  sub={`${kindLabel(offer.study_kind)} · ${offer.blocks.length} blocks`}
                />
              </TableCell>
              <TableCell>{person(offer.offered_by_user_id)?.name ?? "A researcher"}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={decline.isPending || accept.isPending}
                    onClick={() => decide(offer, false)}
                  >
                    Decline {offer.name}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={decline.isPending || accept.isPending}
                    onClick={() => decide(offer, true)}
                  >
                    Accept {offer.name}
                  </Button>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Zone>
  );
}
