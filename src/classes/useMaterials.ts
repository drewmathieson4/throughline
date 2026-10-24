import { useEffect, useState } from "react";
import type { MaterialRow } from "../../worker/api-types";
import { api, messageOf } from "../api";

// A class's course materials, loaded by the class page so its Materials tab can show the count.
export function useMaterials(classId: string) {
  const [materials, setMaterials] = useState<MaterialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<MaterialRow[]>(`/api/materials?classId=${classId}`)
      .then(setMaterials)
      .catch((e) => setError(messageOf(e)));
  }, [classId]);
  return { materials, setMaterials, error };
}
