import { useEffect, useState } from "react";
import type { MaterialRow } from "../../worker/api-types";
import { api, messageOf } from "../api";

// A class's course materials, loaded by the class page so its Materials tab can show the count.
// reload() fetches them again after a document import, which can add or replace some.
export function useMaterials(classId: string) {
  const [materials, setMaterials] = useState<MaterialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api<MaterialRow[]>(`/api/materials?classId=${classId}`)
      .then(setMaterials)
      .catch((e) => setError(messageOf(e)));
  }, [classId, version]);
  return { materials, setMaterials, error, reload: () => setVersion((v) => v + 1) };
}
