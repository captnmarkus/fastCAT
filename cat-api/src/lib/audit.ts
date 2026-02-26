export type AuditEventParams = {
  actorUserId?: number | null;
  actorLabel?: string | null;
  action: string;
  objectType: string;
  objectId: string;
  details?: any;
};

type QueryClient = { query: (text: string, params?: any[]) => Promise<any> };

export async function insertAuditEvent(client: QueryClient, params: AuditEventParams) {
  await client.query(
    `
      INSERT INTO audit_events(
        actor_user_id,
        actor_label,
        action,
        object_type,
        object_id,
        details_json
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      params.actorUserId ?? null,
      params.actorLabel ?? null,
      params.action,
      params.objectType,
      params.objectId,
      JSON.stringify(params.details ?? {})
    ]
  );
}

