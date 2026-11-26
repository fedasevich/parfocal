import { useEffect, useMemo, useState } from "react";
import {
  publishCurrentResult,
  publishResultLookup,
  publishResultObjects,
  type ResultObject,
  useWantedResults,
} from "../annotations/result-objects.ts";
import { cellAt, type PickedCell } from "./result-cell-pick.ts";
import type { PagedCells } from "./viewer-engine.ts";

export type CellComments = { readonly slideId: string; readonly anchorSet: boolean };

const plainCell = /^C([1-9]\d*)$/;

const cellObject = (
  number: number,
  ring: ArrayLike<number>,
  set: string | undefined,
): ResultObject => ({ id: `C${number}`, ring: Array.from(ring), set });

const noObjects: readonly ResultObject[] = [];

export function useCellCommentObjects(
  comments: CellComments | undefined,
  setId: string,
  paged: PagedCells | null,
  picked: PickedCell | null,
) {
  const slideId = comments?.slideId;
  const set = comments?.anchorSet ? setId : undefined;
  const wantedKey = useWantedResults(slideId ?? "").join(",");
  const [loaded, setLoaded] = useState<readonly ResultObject[]>(noObjects);
  useEffect(() => {
    if (slideId === undefined || paged === null || wantedKey === "") return;
    const numbers = wantedKey.split(",").flatMap((id) => {
      const found = id.match(plainCell)?.[1];
      return found === undefined ? [] : [Number(found)];
    });
    let live = true;
    void Promise.all(numbers.map((number) => paged.cell(number).catch(() => null))).then(
      (cells) => {
        if (!live) return;
        setLoaded(
          cells.flatMap((cell) =>
            cell === null || cell.removed ? [] : [cellObject(cell.number, cell.ring, set)],
          ),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [slideId, paged, wantedKey, set]);
  const source = `cells:${setId}`;
  const objects = useMemo(() => {
    const own = picked === null ? [] : [cellObject(picked.number, picked.ring, set)];
    return [...own, ...loaded.filter((item) => own.every((mine) => mine.id !== item.id))];
  }, [picked, loaded, set]);
  useEffect(() => {
    if (slideId === undefined) return;
    publishResultObjects(slideId, objects, source);
    return () => publishResultObjects(slideId, [], source);
  }, [slideId, objects, source]);
  const current = picked === null ? null : `C${picked.number}`;
  useEffect(() => {
    if (slideId === undefined) return;
    publishCurrentResult(slideId, current, source);
    return () => publishCurrentResult(slideId, null, source);
  }, [slideId, current, source]);
  useEffect(() => {
    if (slideId === undefined || paged === null) return;
    publishResultLookup(slideId, source, (at, reach) => {
      const cell = cellAt(setId, paged, [], at, reach);
      return cell === null ? null : cellObject(cell.number, cell.ring, set);
    });
    return () => publishResultLookup(slideId, source, null);
  }, [slideId, paged, source, setId, set]);
}
