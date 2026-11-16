CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
--
CREATE FUNCTION public.parfocal_audit_field(value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT coalesce(length(value)::text || ':' || value, '-')
$$;
--
CREATE FUNCTION public.parfocal_chain_audit_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  last_seq bigint;
  last_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('audit:' || coalesce(NEW.tenant_id::text, 'platform'), 0)
  );
  IF NEW.tenant_id IS NULL THEN
    SELECT seq, hash INTO last_seq, last_hash FROM audit_events
    WHERE tenant_id IS NULL ORDER BY seq DESC LIMIT 1;
  ELSE
    SELECT seq, hash INTO last_seq, last_hash FROM audit_events
    WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  END IF;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := coalesce(last_hash, decode(repeat('00', 32), 'hex'));
  NEW.occurred_at := clock_timestamp();
  NEW.hash := sha256(NEW.prev_hash || convert_to(concat(
    parfocal_audit_field(NEW.id::text),
    parfocal_audit_field(NEW.tenant_id::text),
    parfocal_audit_field(NEW.seq::text),
    parfocal_audit_field(
      to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ),
    parfocal_audit_field(NEW.actor_kind),
    parfocal_audit_field(NEW.actor_id::text),
    parfocal_audit_field(NEW.action),
    parfocal_audit_field(NEW.target_type),
    parfocal_audit_field(NEW.target_id::text),
    parfocal_audit_field(NEW.details)
  ), 'UTF8'));
  RETURN NEW;
END;
$$;
--
CREATE FUNCTION public.parfocal_first_read_kept() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.first_read_at IS NOT NULL
     AND (NEW.first_read_at, NEW.first_read) IS DISTINCT FROM (OLD.first_read_at, OLD.first_read)
  THEN
    RAISE EXCEPTION 'the first read of % on slide % is kept as it was recorded',
      OLD.task_id, OLD.slide_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--
CREATE FUNCTION public.parfocal_guard_user_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (NEW.email IS DISTINCT FROM OLD.email OR NEW.subject IS DISTINCT FROM OLD.subject)
        AND row_security_active(TG_RELID)
        AND NOT (COALESCE(current_setting('app.platform', true), '') = 'on' OR COALESCE(current_setting('app.auth', true), '') = 'on')
    THEN
        RAISE EXCEPTION 'email and subject change only under the auth or platform scope'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$;
--
CREATE FUNCTION public.parfocal_keep_token_revoked() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'a revoked API token stays revoked'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$;
--
CREATE FUNCTION public.parfocal_refuse_audit_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('parfocal.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--
CREATE FUNCTION public.parfocal_result_class_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.result_set_id IS DISTINCT FROM OLD.result_set_id
     OR NEW.position IS DISTINCT FROM OLD.position
     OR NEW.source_name IS DISTINCT FROM OLD.source_name THEN
    RAISE EXCEPTION 'a result set class keeps its source name and position'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.object_count IS DISTINCT FROM OLD.object_count
     AND (SELECT status FROM result_sets WHERE id = NEW.result_set_id) <> 'importing' THEN
    RAISE EXCEPTION 'result set % is not importing', NEW.result_set_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--
CREATE FUNCTION public.parfocal_result_rows_while_importing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT status FROM result_sets WHERE id = NEW.result_set_id) IS DISTINCT FROM 'importing' THEN
    RAISE EXCEPTION 'result set % is not importing', NEW.result_set_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--
CREATE FUNCTION public.parfocal_result_set_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status <> 'importing' AND (
       NEW.status, NEW.name, NEW.model_version, NEW.source, NEW.source_file, NEW.produced_at,
       NEW.error_code, NEW.cell_count, NEW.region_count, NEW.zone_count, NEW.job_id,
       NEW.slide_id, NEW.project_id, NEW.tenant_id, NEW.created_by_user_id, NEW.created_at
     ) IS DISTINCT FROM (
       OLD.status, OLD.name, OLD.model_version, OLD.source, OLD.source_file, OLD.produced_at,
       OLD.error_code, OLD.cell_count, OLD.region_count, OLD.zone_count, OLD.job_id,
       OLD.slide_id, OLD.project_id, OLD.tenant_id, OLD.created_by_user_id, OLD.created_at
     ) THEN
    RAISE EXCEPTION 'result set % is %, only deleting it is allowed', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--
CREATE FUNCTION public.parfocal_retention_purge() RETURNS TABLE(kind text, id uuid, detail jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  policy record;
  cutoff timestamptz;
  through bigint;
  last_hash bytea;
  purged bigint;
BEGIN
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'retention needs a tenant scope' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO policy FROM retention_policies p WHERE p.tenant_id = tenant;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM legal_holds h
    WHERE h.tenant_id = tenant AND h.project_id IS NULL AND h.released_at IS NULL
  ) THEN
    RETURN QUERY SELECT 'held-workspace'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  CREATE TEMP TABLE held ON COMMIT DROP AS
    SELECT DISTINCT h.project_id FROM legal_holds h
    WHERE h.tenant_id = tenant AND h.project_id IS NOT NULL AND h.released_at IS NULL;
  IF policy.deleted_after_days IS NOT NULL THEN
    cutoff := now() - make_interval(days => policy.deleted_after_days);
    RETURN QUERY
      SELECT 'kept-held'::text, a.id, NULL::jsonb FROM annotations a
      WHERE a.tenant_id = tenant AND a.deleted_at < cutoff
        AND a.project_id IN (SELECT project_id FROM held)
      UNION ALL
      SELECT 'kept-held', r.id, NULL FROM result_sets r
      WHERE r.tenant_id = tenant AND r.deleted_at < cutoff
        AND r.project_id IN (SELECT project_id FROM held)
      UNION ALL
      SELECT 'kept-held', s.id, NULL FROM slides s
      WHERE s.tenant_id = tenant AND s.deleted_at < cutoff
        AND s.project_id IN (SELECT project_id FROM held);
    RETURN QUERY
      WITH doomed AS (
        SELECT a.id FROM annotations a
        WHERE a.tenant_id = tenant AND a.deleted_at < cutoff
          AND a.project_id NOT IN (SELECT project_id FROM held)
      ), versions AS (
        DELETE FROM annotation_versions v USING doomed d WHERE v.annotation_id = d.id
      ), gone AS (
        DELETE FROM annotations a USING doomed d WHERE a.id = d.id RETURNING a.id
      )
      SELECT 'annotation'::text, gone.id, NULL::jsonb FROM gone;
    RETURN QUERY
      SELECT 'kept-in-use'::text, r.id, NULL::jsonb FROM result_sets r
      WHERE r.tenant_id = tenant AND r.deleted_at < cutoff
        AND r.project_id NOT IN (SELECT project_id FROM held)
        AND EXISTS (SELECT 1 FROM review_task_slides t WHERE t.result_set_id = r.id);
    RETURN QUERY
      WITH doomed AS (
        SELECT r.id FROM result_sets r
        WHERE r.tenant_id = tenant AND r.deleted_at < cutoff
          AND r.project_id NOT IN (SELECT project_id FROM held)
          AND NOT EXISTS (SELECT 1 FROM review_task_slides t WHERE t.result_set_id = r.id)
      ), classes AS (
        DELETE FROM result_set_classes c USING doomed d WHERE c.result_set_id = d.id
      ), objects AS (
        DELETE FROM result_objects o USING doomed d WHERE o.result_set_id = d.id
      ), chunks AS (
        DELETE FROM result_chunks c USING doomed d WHERE c.result_set_id = d.id
      ), gone AS (
        DELETE FROM result_sets r USING doomed d WHERE r.id = d.id RETURNING r.id
      )
      SELECT 'result-set'::text, gone.id, NULL::jsonb FROM gone;
    RETURN QUERY
      SELECT 'kept-in-use'::text, s.id, NULL::jsonb FROM slides s
      WHERE s.tenant_id = tenant AND s.deleted_at < cutoff
        AND s.project_id NOT IN (SELECT project_id FROM held)
        AND (
          EXISTS (SELECT 1 FROM review_task_slides t WHERE t.slide_id = s.id)
          OR EXISTS (SELECT 1 FROM result_sets r WHERE r.slide_id = s.id)
          OR EXISTS (SELECT 1 FROM annotations a WHERE a.slide_id = s.id)
        );
    RETURN QUERY
      WITH doomed AS (
        SELECT s.id FROM slides s
        WHERE s.tenant_id = tenant AND s.deleted_at < cutoff
          AND s.project_id NOT IN (SELECT project_id FROM held)
          AND NOT EXISTS (SELECT 1 FROM review_task_slides t WHERE t.slide_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM result_sets r WHERE r.slide_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.slide_id = s.id)
      ), counters AS (
        DELETE FROM slide_counters c USING doomed d WHERE c.slide_id = d.id
      ), gone AS (
        DELETE FROM slides s USING doomed d WHERE s.id = d.id RETURNING s.id
      )
      SELECT 'slide'::text, gone.id, NULL::jsonb FROM gone;
  END IF;
  IF policy.audit_after_days IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || tenant::text, 0));
    SELECT e.seq, e.hash INTO through, last_hash FROM audit_events e
    WHERE e.tenant_id = tenant
      AND e.occurred_at < now() - make_interval(days => policy.audit_after_days)
    ORDER BY e.seq DESC LIMIT 1;
    IF FOUND THEN
      PERFORM set_config('parfocal.audit_purge', 'on', true);
      DELETE FROM audit_events e WHERE e.tenant_id = tenant AND e.seq <= through;
      GET DIAGNOSTICS purged = ROW_COUNT;
      PERFORM set_config('parfocal.audit_purge', 'off', true);
      RETURN QUERY SELECT 'audit'::text, NULL::uuid, jsonb_build_object(
        'through_seq', through, 'last_hash', encode(last_hash, 'hex'), 'count', purged
      );
    END IF;
  END IF;
END;
$$;
--
CREATE FUNCTION public.parfocal_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--
CREATE TABLE public.adjudication_objects (
    adjudication_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    number integer NOT NULL,
    CONSTRAINT ck_adjudication_objects_kind CHECK ((kind IN ('region', 'cell'))),
    CONSTRAINT ck_adjudication_objects_number CHECK ((number > 0))
);
--
ALTER TABLE ONLY public.adjudication_objects FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.adjudications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    adjudicator_user_id uuid NOT NULL,
    sent_by_user_id uuid,
    note character varying(300),
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    declined_at timestamp with time zone,
    declined_note character varying(300),
    CONSTRAINT ck_adjudications_declined_with_note CHECK (((declined_note IS NULL) OR (declined_at IS NOT NULL)))
);
--
ALTER TABLE ONLY public.adjudications FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.annotation_versions (
    tenant_id uuid NOT NULL,
    annotation_id uuid NOT NULL,
    version integer NOT NULL,
    change character varying(20) NOT NULL,
    geometry public.geometry NOT NULL,
    class_id uuid,
    changed_by_user_id uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    text character varying(200),
    CONSTRAINT ck_annotation_versions_change CHECK ((change IN ('created', 'edited', 'deleted', 'restored')))
);
--
ALTER TABLE ONLY public.annotation_versions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.annotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    number integer NOT NULL,
    geometry public.geometry NOT NULL,
    class_id uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    task_id uuid,
    origin character varying(16) DEFAULT 'human'::character varying NOT NULL,
    source_number integer,
    text character varying(200),
    CONSTRAINT ck_annotations_geometry_valid CHECK (public.st_isvalid(geometry)),
    CONSTRAINT ck_annotations_kind CHECK ((kind IN ('roi', 'measurement', 'region', 'cell', 'arrow', 'text'))),
    CONSTRAINT ck_annotations_number CHECK ((number > 0)),
    CONSTRAINT ck_annotations_origin CHECK ((origin IN ('human', 'ai-edited', 'ai-confirmed'))),
    CONSTRAINT ck_annotations_source CHECK ((((origin)::text <> 'human'::text) = (source_number IS NOT NULL))),
    CONSTRAINT ck_annotations_source_task CHECK ((((origin)::text = 'human'::text) OR (task_id IS NOT NULL))),
    CONSTRAINT ck_annotations_text CHECK ((((kind)::text = 'text'::text) = (text IS NOT NULL))),
    CONSTRAINT ck_annotations_version CHECK ((version > 0))
);
--
ALTER TABLE ONLY public.annotations FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    text character varying(280) NOT NULL,
    ends_at timestamp with time zone,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_announcements_kind CHECK ((kind IN ('model', 'slowdown', 'change')))
);
--
ALTER TABLE ONLY public.announcements FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.api_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service_account_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.api_tokens FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    seq bigint NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    actor_kind character varying(20) NOT NULL,
    actor_id uuid,
    action character varying(60) NOT NULL,
    target_type character varying(40) NOT NULL,
    target_id uuid,
    details text DEFAULT '{}'::text NOT NULL,
    prev_hash bytea NOT NULL,
    hash bytea NOT NULL,
    CONSTRAINT ck_audit_events_actor_kind CHECK ((actor_kind IN ('user', 'member', 'operator', 'system', 'service')))
);
--
ALTER TABLE ONLY public.audit_events FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.audit_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject character varying(200) NOT NULL
);
--
ALTER TABLE ONLY public.audit_people FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.auth_logins (
    state_hash bytea NOT NULL,
    binding_hash bytea NOT NULL,
    code_verifier character varying(200) NOT NULL,
    nonce character varying(200) NOT NULL,
    return_to character varying(2000) NOT NULL,
    expires_at timestamp with time zone NOT NULL
);
--
ALTER TABLE ONLY public.auth_logins FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    specimen_id uuid NOT NULL,
    number smallint NOT NULL,
    description character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    stains character varying(60)[] DEFAULT '{}'::character varying[] NOT NULL,
    levels smallint DEFAULT '1'::smallint NOT NULL,
    CONSTRAINT ck_blocks_levels CHECK (((levels >= 1) AND (levels <= 50))),
    CONSTRAINT ck_blocks_number CHECK (((number >= 1) AND (number <= 999)))
);
--
ALTER TABLE ONLY public.blocks FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.case_requests (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_key character varying(100) NOT NULL,
    case_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.case_requests FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    patient_id uuid,
    label character varying(100) NOT NULL,
    source character varying(10) NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    label_lower text GENERATED ALWAYS AS (lower((label)::text)) STORED NOT NULL,
    clinical_note_ciphertext bytea,
    CONSTRAINT ck_cases_source CHECK ((source IN ('manual', 'upload', 'import')))
);
--
ALTER TABLE ONLY public.cases FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.class_mappings (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_name character varying(120) NOT NULL,
    class_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.class_mappings FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.clinical_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    report_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    object_id character varying(40),
    size_mm double precision,
    note character varying(300),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_clinical_deposits_size_mm CHECK (((size_mm IS NULL) OR (size_mm > (0)::double precision))),
    CONSTRAINT ck_clinical_deposits_source CHECK (((object_id IS NOT NULL) OR (size_mm IS NOT NULL)))
);
--
ALTER TABLE ONLY public.clinical_deposits FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.clinical_report_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    report_id uuid NOT NULL,
    number integer NOT NULL,
    content jsonb NOT NULL,
    reason character varying(300),
    signed_by_user_id uuid,
    reported_by_user_id uuid,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_clinical_report_versions_number CHECK ((number >= 1)),
    CONSTRAINT ck_clinical_report_versions_reason CHECK (((number = 1) = (reason IS NULL)))
);
--
ALTER TABLE ONLY public.clinical_report_versions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.clinical_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    case_id uuid NOT NULL,
    template character varying(30) NOT NULL,
    template_version smallint NOT NULL,
    state character varying(10) NOT NULL,
    specimen character varying(200),
    category character varying(10),
    confirmed_against character varying(10),
    nodes_examined smallint,
    extranodal character varying(10),
    diagnosis character varying(2000),
    microscopic character varying(5000),
    comment character varying(2000),
    cosigner_user_id uuid,
    sent_by_user_id uuid,
    return_note character varying(300),
    version integer DEFAULT 0 NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_content jsonb,
    sent_at timestamp with time zone,
    CONSTRAINT ck_clinical_reports_category CHECK ((category IN ('none', 'itc', 'micro', 'macro'))),
    CONSTRAINT ck_clinical_reports_confirmed_against CHECK ((confirmed_against IN ('none', 'itc', 'micro', 'macro'))),
    CONSTRAINT ck_clinical_reports_extranodal CHECK ((extranodal IN ('present', 'absent', 'na'))),
    CONSTRAINT ck_clinical_reports_nodes_examined CHECK (((nodes_examined IS NULL) OR (nodes_examined >= 0))),
    CONSTRAINT ck_clinical_reports_state CHECK ((state IN ('draft', 'sent', 'returned', 'signed', 'amended'))),
    CONSTRAINT ck_clinical_reports_template CHECK ((template IN ('sentinel-node', 'lymph-node-excision'))),
    CONSTRAINT ck_clinical_reports_template_version CHECK ((template_version >= 1)),
    CONSTRAINT ck_clinical_reports_version CHECK ((version >= 0))
);
--
ALTER TABLE ONLY public.clinical_reports FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.disagreement_decisions (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    number integer NOT NULL,
    decision character varying(20),
    note character varying(500),
    decided_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    style character varying(10),
    answer character varying(10),
    answer_class_id uuid,
    value character varying(10),
    left_open boolean DEFAULT false NOT NULL,
    edits_settled_at timestamp with time zone,
    CONSTRAINT ck_disagreement_decisions_answer_fits_style CHECK (((style IS NULL) OR (((style)::text = 'certainty'::text) AND (answer IN ('1', '2', '3', '4', '5', 'unsure'))) OR (((style)::text = 'agree'::text) AND (answer IN ('agree', 'disagree', 'unsure'))) OR (((style)::text = 'yes-no'::text) AND (answer IN ('yes', 'no', 'unsure'))) OR (((style)::text = 'blind'::text) AND (answer IN ('class', 'unsure'))))),
    CONSTRAINT ck_disagreement_decisions_answer_names_class CHECK (((((answer)::text = 'class'::text) = (answer_class_id IS NOT NULL)) AND ((answer IS NOT NULL) OR (answer_class_id IS NULL)))),
    CONSTRAINT ck_disagreement_decisions_decided_or_left_open CHECK (((NOT (left_open AND (value IS NOT NULL))) AND (left_open OR (value IS NOT NULL) OR (edits_settled_at IS NOT NULL)))),
    CONSTRAINT ck_disagreement_decisions_decision CHECK ((decision IN ('keep-ai', 'go-with-reviewers'))),
    CONSTRAINT ck_disagreement_decisions_kind CHECK ((kind IN ('region', 'cell'))),
    CONSTRAINT ck_disagreement_decisions_number CHECK ((number > 0)),
    CONSTRAINT ck_disagreement_decisions_style CHECK (((style IS NULL) OR (style IN ('certainty', 'agree', 'yes-no', 'blind')))),
    CONSTRAINT ck_disagreement_decisions_style_with_answer CHECK (((style IS NULL) = (answer IS NULL))),
    CONSTRAINT ck_disagreement_decisions_value CHECK (((value IS NULL) OR (value IN ('agree', 'disagree', 'unsure'))))
);
--
ALTER TABLE ONLY public.disagreement_decisions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.display_choices (
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    preset_id uuid,
    settings jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.display_choices FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.display_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    task_id uuid,
    name character varying(40) NOT NULL,
    settings jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.display_presets FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.emergency_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    privacy_mode character varying(20) DEFAULT 'clinical'::character varying NOT NULL,
    reason character varying(500) NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_emergency_grants_clinical_only CHECK (((privacy_mode)::text = 'clinical'::text))
);
--
ALTER TABLE ONLY public.emergency_grants FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.evaluation_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    version integer NOT NULL,
    slide_id uuid NOT NULL,
    object_id character varying(40) NOT NULL,
    change character varying(200) NOT NULL,
    reason character varying(500) NOT NULL,
    changed_by_user_id uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.evaluation_changes FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.evaluation_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    number integer NOT NULL,
    reason character varying(500),
    started_by_user_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_at timestamp with time zone,
    signed_by_user_id uuid,
    confirmed_with character varying(10),
    checksum character varying(80),
    evaluation jsonb,
    blocks jsonb,
    format jsonb,
    CONSTRAINT ck_evaluation_versions_confirmed_with CHECK (((confirmed_with IS NULL) OR (confirmed_with IN ('sso', 'password')))),
    CONSTRAINT ck_evaluation_versions_number CHECK ((number >= 1)),
    CONSTRAINT ck_evaluation_versions_signed CHECK (((signed_at IS NULL) = (checksum IS NULL)))
);
--
ALTER TABLE ONLY public.evaluation_versions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.gpu_usage (
    id bigint NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    kind character varying(40) NOT NULL,
    model character varying(80),
    model_version character varying(40),
    tier character varying(20),
    gpu character varying(40),
    worker character varying(80) NOT NULL,
    seconds double precision NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.gpu_usage FORCE ROW LEVEL SECURITY;
--
ALTER TABLE public.gpu_usage ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.gpu_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--
CREATE TABLE public.hidden_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    model_name character varying(80) NOT NULL,
    hidden_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.hidden_models FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email character varying(320) NOT NULL,
    role character varying(30) NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_rights boolean DEFAULT false NOT NULL,
    task_id uuid,
    CONSTRAINT ck_invitations_admin_rights CHECK (((NOT admin_rights) OR ((role)::text = 'researcher'::text))),
    CONSTRAINT ck_invitations_role CHECK ((role IN ('researcher', 'reviewer')))
);
--
ALTER TABLE ONLY public.invitations FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.job_steps (
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    name character varying(40) NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    runs integer DEFAULT 0 NOT NULL,
    result jsonb,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    units_total integer,
    CONSTRAINT ck_job_steps_status CHECK ((status IN ('pending', 'running', 'done', 'failed'))),
    CONSTRAINT ck_job_steps_units_total CHECK (((units_total IS NULL) OR (units_total >= 0)))
);
--
ALTER TABLE ONLY public.job_steps FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.job_units (
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    unit integer NOT NULL,
    worker character varying(80) NOT NULL,
    done_at timestamp with time zone DEFAULT now() NOT NULL,
    seq bigint NOT NULL,
    result jsonb
);
--
ALTER TABLE ONLY public.job_units FORCE ROW LEVEL SECURITY;
--
ALTER TABLE public.job_units ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.job_units_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
--
CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid,
    kind character varying(40) NOT NULL,
    status character varying(10) DEFAULT 'queued'::character varying NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    claimed_by character varying(80),
    claims integer DEFAULT 0 NOT NULL,
    lease_until timestamp with time zone,
    error_code character varying(60),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    pause_reason character varying(60),
    tries integer DEFAULT 0 NOT NULL,
    CONSTRAINT ck_jobs_pause_reason CHECK ((((status)::text = 'paused'::text) = (pause_reason IS NOT NULL))),
    CONSTRAINT ck_jobs_status CHECK ((status IN ('queued', 'running', 'paused', 'cancelling', 'cancelled', 'done', 'failed')))
);
--
ALTER TABLE ONLY public.jobs FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.lab_model_projects (
    lab_model_id uuid NOT NULL,
    project_id uuid NOT NULL,
    tenant_id uuid NOT NULL
);
--
ALTER TABLE ONLY public.lab_model_projects FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.lab_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(80) NOT NULL,
    version character varying(40) NOT NULL,
    address character varying(2048) NOT NULL,
    sign_in character varying(10) NOT NULL,
    header_name character varying(80),
    secret_ciphertext bytea,
    secret_last_four character varying(4),
    tile_size integer NOT NULL,
    magnification integer NOT NULL,
    taxonomy character varying(40) NOT NULL,
    class_map jsonb NOT NULL,
    who_can_run character varying(20) NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    licence_weights character varying(400),
    licence_weights_class character varying(20),
    licence_code character varying(400),
    licence_data jsonb,
    licence_source character varying(400),
    licence_read_on date,
    CONSTRAINT ck_lab_models_sign_in CHECK ((sign_in IN ('none', 'token', 'header'))),
    CONSTRAINT ck_lab_models_who_can_run CHECK ((who_can_run IN ('admins', 'researchers')))
);
--
ALTER TABLE ONLY public.lab_models FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.legal_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid,
    reason character varying(500) NOT NULL,
    placed_by_user_id uuid,
    released_at timestamp with time zone,
    released_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.legal_holds FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role character varying(30) NOT NULL,
    availability character varying(10) DEFAULT 'available'::character varying NOT NULL,
    available_again_at timestamp with time zone,
    availability_note character varying(200),
    admin_rights boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_memberships_admin_rights CHECK (((NOT admin_rights) OR ((role)::text = 'researcher'::text))),
    CONSTRAINT ck_memberships_availability CHECK ((((availability)::text = 'away'::text) OR (((availability)::text = 'available'::text) AND (available_again_at IS NULL) AND (availability_note IS NULL)))),
    CONSTRAINT ck_memberships_role CHECK ((role IN ('researcher', 'reviewer')))
);
--
ALTER TABLE ONLY public.memberships FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.model_runs (
    job_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    task_id uuid,
    batch_id uuid NOT NULL,
    scope_kind character varying(10) NOT NULL,
    scope jsonb,
    detector character varying(80) NOT NULL,
    detector_version character varying(40) NOT NULL,
    typer character varying(80),
    typer_version character varying(40),
    test_time_views smallint NOT NULL,
    ordering character varying(12) NOT NULL,
    started_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tier character varying(10),
    CONSTRAINT ck_model_runs_ordering CHECK ((ordering IN ('raster', 'tumor-first'))),
    CONSTRAINT ck_model_runs_scope CHECK ((((scope_kind)::text = 'slide'::text) = (scope IS NULL))),
    CONSTRAINT ck_model_runs_scope_kind CHECK ((scope_kind IN ('view', 'selection', 'slide'))),
    CONSTRAINT ck_model_runs_test_time_views CHECK ((test_time_views = ANY (ARRAY[1, 8]))),
    CONSTRAINT ck_model_runs_tier CHECK ((tier IN ('best', 'good', 'fast'))),
    CONSTRAINT ck_model_runs_typer_version CHECK (((typer IS NULL) = (typer_version IS NULL))),
    CONSTRAINT ck_model_runs_views_need_typer CHECK (((test_time_views = 1) OR (typer IS NOT NULL)))
);
--
ALTER TABLE ONLY public.model_runs FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.model_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task character varying(10) NOT NULL,
    tier character varying(10) NOT NULL,
    model_name character varying(80) NOT NULL,
    model_version character varying(40) NOT NULL,
    set_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_model_tiers_task CHECK ((task IN ('tumor', 'outline', 'typer'))),
    CONSTRAINT ck_model_tiers_tier CHECK ((tier IN ('best', 'good', 'fast')))
);
--
ALTER TABLE ONLY public.model_tiers FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.notification_mutes (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    subject character varying(10) NOT NULL,
    subject_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_notification_mutes_subject CHECK ((subject IN ('project', 'task', 'case')))
);
--
ALTER TABLE ONLY public.notification_mutes FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.notification_preferences (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(30) NOT NULL,
    in_app boolean NOT NULL,
    email boolean NOT NULL,
    realtime boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_notification_preferences_kind CHECK ((kind IN ('mention', 'reply', 'task-assigned', 'model-run-finished', 'model-run-paused', 'upload-done', 'disagreements-ready', 'task-signed-off', 'emergency-access', 'task-due-soon', 'result-set-added', 'integration-down', 'task-nudged', 'task-reassigned', 'task-due-changed', 'upload-refused', 'adjudication-requested', 'slide-moved', 'workspace-access-asked', 'template-offered')))
);
--
ALTER TABLE ONLY public.notification_preferences FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(30) NOT NULL,
    target_type character varying(30) NOT NULL,
    target_id uuid NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    in_app boolean NOT NULL,
    realtime boolean NOT NULL,
    email_status character varying(10) NOT NULL,
    emailed_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    task_id uuid,
    case_id uuid,
    muted boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_notifications_email CHECK ((email_status IN ('none', 'pending', 'sent', 'skipped'))),
    CONSTRAINT ck_notifications_kind CHECK ((kind IN ('mention', 'reply', 'task-assigned', 'model-run-finished', 'model-run-paused', 'upload-done', 'disagreements-ready', 'task-signed-off', 'emergency-access', 'task-due-soon', 'result-set-added', 'integration-down', 'task-nudged', 'task-reassigned', 'task-due-changed', 'upload-refused', 'adjudication-requested', 'slide-moved', 'workspace-access-asked', 'template-offered')))
);
--
ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.opinion_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version smallint NOT NULL,
    questions jsonb NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_opinion_forms_version CHECK ((version >= 1))
);
--
ALTER TABLE ONLY public.opinion_forms FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.opinions (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    user_id uuid NOT NULL,
    form_version smallint NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.opinions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.organisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(40) NOT NULL,
    name character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_organisations_slug CHECK (((slug)::text ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text))
);
--
ALTER TABLE ONLY public.organisations FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name_ciphertext bytea NOT NULL,
    name_tokens bytea[] NOT NULL,
    mrn_ciphertext bytea,
    mrn_index bytea,
    birth_date_ciphertext bytea,
    birth_date_index bytea,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    sex character varying(10) DEFAULT 'unknown'::character varying NOT NULL,
    age_years smallint,
    project_id uuid NOT NULL,
    privacy_mode character varying(20) DEFAULT 'clinical'::character varying NOT NULL,
    CONSTRAINT ck_patients_age_years CHECK (((age_years >= 0) AND (age_years <= 150))),
    CONSTRAINT ck_patients_clinical_only CHECK (((privacy_mode)::text = 'clinical'::text)),
    CONSTRAINT ck_patients_sex CHECK ((sex IN ('male', 'female', 'other', 'unknown')))
);
--
ALTER TABLE ONLY public.patients FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.personal_settings (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.personal_settings FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.platform_operators (
    subject character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.platform_operators FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.project_classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    key smallint NOT NULL,
    name character varying(60) NOT NULL,
    colour character varying(7) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_project_classes_colour CHECK (((colour)::text ~ '^#[0-9a-f]{6}$'::text)),
    CONSTRAINT ck_project_classes_key CHECK (((key >= 1) AND (key <= 9)))
);
--
ALTER TABLE ONLY public.project_classes FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.project_members (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(10) NOT NULL,
    sign_out character varying(10),
    CONSTRAINT ck_project_members_role CHECK ((role IN ('owner', 'reviewer', 'viewer'))),
    CONSTRAINT ck_project_members_sign_out CHECK ((sign_out IN ('own', 'any', 'never')))
);
--
ALTER TABLE ONLY public.project_members FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    number smallint NOT NULL,
    name character varying(120) NOT NULL,
    privacy_mode character varying(20) DEFAULT 'de-identified'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    colour smallint DEFAULT '0'::smallint NOT NULL,
    template character varying(20) DEFAULT 'none'::character varying NOT NULL,
    archived_at timestamp with time zone,
    created_by_user_id uuid,
    sample boolean DEFAULT false NOT NULL,
    name_lower text GENERATED ALWAYS AS (lower((name)::text)) STORED NOT NULL,
    clinical_template character varying(30) DEFAULT 'sentinel-node'::character varying NOT NULL,
    blinded boolean DEFAULT true NOT NULL,
    ai_hidden_first_read boolean DEFAULT false NOT NULL,
    study_template_id uuid,
    match_iou double precision DEFAULT '0.5'::double precision NOT NULL,
    match_distance_um double precision DEFAULT '4'::double precision NOT NULL,
    CONSTRAINT ck_projects_clinical_template CHECK ((clinical_template IN ('sentinel-node', 'lymph-node-excision'))),
    CONSTRAINT ck_projects_colour CHECK (((colour >= 0) AND (colour <= 11))),
    CONSTRAINT ck_projects_match_distance_um CHECK (((match_distance_um > (0)::double precision) AND (match_distance_um <= (50)::double precision))),
    CONSTRAINT ck_projects_match_iou CHECK (((match_iou > (0)::double precision) AND (match_iou <= (1)::double precision))),
    CONSTRAINT ck_projects_number CHECK (((number >= 1) AND (number <= 9999))),
    CONSTRAINT ck_projects_privacy_mode CHECK ((privacy_mode IN ('de-identified', 'clinical'))),
    CONSTRAINT ck_projects_template CHECK ((template IN ('none', 'sentinel-node', 'cell-review')))
);
--
ALTER TABLE ONLY public.projects FORCE ROW LEVEL SECURITY;
--
CREATE UNLOGGED TABLE public.rate_counters (
    key character varying(80) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer NOT NULL
);
--
ALTER TABLE ONLY public.rate_counters FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.registered_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(80) NOT NULL,
    version character varying(40) NOT NULL,
    family character varying(120) NOT NULL,
    title character varying(200) NOT NULL,
    tasks jsonb NOT NULL,
    makes jsonb NOT NULL,
    host character varying(20) NOT NULL,
    licence_weights character varying(400) NOT NULL,
    licence_weights_class character varying(20) NOT NULL,
    licence_code character varying(400) NOT NULL,
    licence_data jsonb NOT NULL,
    licence_source character varying(400) NOT NULL,
    licence_read_on date NOT NULL,
    allowed_tenant_kinds jsonb NOT NULL,
    input_mpp double precision,
    status character varying(20) NOT NULL,
    evaluation_report character varying(400),
    calibration_temperatures jsonb NOT NULL,
    part_of_name character varying(80),
    part_of_version character varying(40),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    evaluation jsonb,
    CONSTRAINT ck_registered_models_host CHECK ((host IN ('parfocal', 'lab'))),
    CONSTRAINT ck_registered_models_licence_weights_class CHECK ((licence_weights_class IN ('permitted', 'restricted', 'unconfirmed', 'own'))),
    CONSTRAINT ck_registered_models_part_of CHECK (((part_of_name IS NULL) = (part_of_version IS NULL))),
    CONSTRAINT ck_registered_models_status CHECK ((status IN ('candidate', 'validated', 'retired')))
);
--
ALTER TABLE ONLY public.registered_models FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.report_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    created_by_user_id uuid,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    opened_count integer DEFAULT 0 NOT NULL,
    last_opened_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.report_links FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.result_chunks (
    tenant_id uuid NOT NULL,
    result_set_id uuid NOT NULL,
    chunk integer NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    cell_count integer NOT NULL,
    vertex_count integer NOT NULL,
    object_key character varying(300) NOT NULL,
    CONSTRAINT ck_result_chunks_chunk CHECK ((chunk >= 0)),
    CONSTRAINT ck_result_chunks_counts CHECK (((cell_count > 0) AND (vertex_count >= 0))),
    CONSTRAINT ck_result_chunks_size CHECK (((width > 0) AND (height > 0)))
);
--
ALTER TABLE ONLY public.result_chunks FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.result_objects (
    tenant_id uuid NOT NULL,
    result_set_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    number integer NOT NULL,
    geometry public.geometry NOT NULL,
    class_index smallint,
    score smallint,
    probabilities smallint[],
    parent_number integer,
    CONSTRAINT ck_result_objects_geometry_valid CHECK (public.st_isvalid(geometry)),
    CONSTRAINT ck_result_objects_kind CHECK ((kind IN ('region', 'zone'))),
    CONSTRAINT ck_result_objects_number CHECK ((number > 0)),
    CONSTRAINT ck_result_objects_score CHECK (((score >= 0) AND (score <= 255)))
);
--
ALTER TABLE ONLY public.result_objects FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.result_set_classes (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    result_set_id uuid NOT NULL,
    "position" smallint NOT NULL,
    source_name character varying(120) NOT NULL,
    class_id uuid,
    object_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT ck_result_set_classes_object_count CHECK ((object_count >= 0)),
    CONSTRAINT ck_result_set_classes_position CHECK ((("position" >= 0) AND ("position" <= 254)))
);
--
ALTER TABLE ONLY public.result_set_classes FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.result_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    model_version character varying(60),
    source character varying(10) NOT NULL,
    source_file character varying(255),
    produced_at timestamp with time zone,
    status character varying(10) DEFAULT 'importing'::character varying NOT NULL,
    error_code character varying(60),
    cell_count integer DEFAULT 0 NOT NULL,
    region_count integer DEFAULT 0 NOT NULL,
    zone_count integer DEFAULT 0 NOT NULL,
    job_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_result_sets_counts CHECK (((cell_count >= 0) AND (region_count >= 0) AND (zone_count >= 0))),
    CONSTRAINT ck_result_sets_source CHECK ((source IN ('import', 'run'))),
    CONSTRAINT ck_result_sets_status CHECK ((status IN ('importing', 'ready', 'failed')))
);
--
ALTER TABLE ONLY public.result_sets FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.resume_states (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    mode character varying(10) NOT NULL,
    object_id character varying(40),
    camera jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_resume_states_mode CHECK ((mode IN ('guided', 'viewer')))
);
--
ALTER TABLE ONLY public.resume_states FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.retention_policies (
    tenant_id uuid NOT NULL,
    deleted_after_days integer,
    audit_after_days integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_retention_policies_audit_after_days CHECK ((audit_after_days >= 365)),
    CONSTRAINT ck_retention_policies_deleted_after_days CHECK ((deleted_after_days >= 1))
);
--
ALTER TABLE ONLY public.retention_policies FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_assignments (
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    user_id uuid NOT NULL,
    submitted_at timestamp with time zone,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    first_read_at timestamp with time zone,
    first_read jsonb,
    released_at timestamp with time zone,
    nothing_to_mark boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_review_assignments_first_read_pair CHECK (((first_read_at IS NULL) = (first_read IS NULL))),
    CONSTRAINT ck_review_assignments_nothing_to_mark CHECK (((NOT nothing_to_mark) OR (submitted_at IS NOT NULL)))
);
--
ALTER TABLE ONLY public.review_assignments FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_decisions (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    number integer NOT NULL,
    value character varying(10) NOT NULL,
    reason_class_id uuid,
    note character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reasons character varying(20)[] DEFAULT '{}'::character varying[] NOT NULL,
    style character varying(10) NOT NULL,
    answer character varying(10) NOT NULL,
    answer_class_id uuid,
    reopened_at timestamp with time zone,
    reopened_note character varying(500),
    preset character varying(40),
    ai_class_id uuid,
    ai_score smallint,
    CONSTRAINT ck_review_decisions_ai_score CHECK (((ai_score >= 0) AND (ai_score <= 255))),
    CONSTRAINT ck_review_decisions_answer_fits_style CHECK (((((style)::text = 'certainty'::text) AND (answer IN ('1', '2', '3', '4', '5', 'unsure'))) OR (((style)::text = 'agree'::text) AND (answer IN ('agree', 'disagree', 'unsure'))) OR (((style)::text = 'yes-no'::text) AND (answer IN ('yes', 'no', 'unsure'))) OR (((style)::text = 'blind'::text) AND (answer IN ('class', 'unsure'))))),
    CONSTRAINT ck_review_decisions_answer_names_class CHECK ((((answer)::text = 'class'::text) = (answer_class_id IS NOT NULL))),
    CONSTRAINT ck_review_decisions_kind CHECK ((kind IN ('region', 'cell'))),
    CONSTRAINT ck_review_decisions_number CHECK ((number > 0)),
    CONSTRAINT ck_review_decisions_reasons_fit CHECK (((((value)::text = 'agree'::text) AND (cardinality(reasons) = 0)) OR (((value)::text = 'unsure'::text) AND (reasons <@ ARRAY['need_deeper_level'::character varying, 'need_ihc'::character varying, 'border_unclear'::character varying, 'out_of_focus'::character varying, 'need_second_look'::character varying])) OR (((value)::text = 'disagree'::text) AND ((kind)::text = 'region'::text) AND (reasons <@ ARRAY['not_class'::character varying, 'boundary_off'::character varying, 'two_regions'::character varying, 'artefact'::character varying])) OR (((value)::text = 'disagree'::text) AND ((kind)::text = 'cell'::text) AND (reasons <@ ARRAY['not_a_cell'::character varying, 'wrong_class'::character varying, 'boundary_off'::character varying, 'artefact'::character varying])))),
    CONSTRAINT ck_review_decisions_style CHECK ((style IN ('certainty', 'agree', 'yes-no', 'blind'))),
    CONSTRAINT ck_review_decisions_value CHECK ((value IN ('agree', 'disagree', 'unsure'))),
    CONSTRAINT ck_review_decisions_wrong_class_names_class CHECK ((('wrong_class'::text = ANY ((reasons)::text[])) = (reason_class_id IS NOT NULL)))
);
--
ALTER TABLE ONLY public.review_decisions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_edits (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    number integer NOT NULL,
    class_id uuid,
    geometry public.geometry,
    deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    split character varying(26) DEFAULT ''::character varying NOT NULL,
    retired character varying(10),
    merged_into_number integer,
    merged_into_split character varying(26),
    CONSTRAINT ck_review_edits_changes_something CHECK ((deleted OR (retired IS NOT NULL) OR (class_id IS NOT NULL) OR (geometry IS NOT NULL))),
    CONSTRAINT ck_review_edits_geometry_valid CHECK (((geometry IS NULL) OR public.st_isvalid(geometry))),
    CONSTRAINT ck_review_edits_kind CHECK ((kind IN ('region', 'cell'))),
    CONSTRAINT ck_review_edits_merged_into CHECK ((((retired)::text = 'merged'::text) = ((merged_into_number IS NOT NULL) AND (merged_into_split IS NOT NULL)))),
    CONSTRAINT ck_review_edits_number CHECK ((number > 0)),
    CONSTRAINT ck_review_edits_retired CHECK ((retired IN ('split', 'merged'))),
    CONSTRAINT ck_review_edits_split CHECK (((split)::text ~ '^[a-z]*$'::text))
);
--
ALTER TABLE ONLY public.review_edits FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_order (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    seed bigint NOT NULL,
    count integer NOT NULL,
    objects bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_review_order_count CHECK ((count >= 0)),
    CONSTRAINT ck_review_order_packed CHECK ((octet_length(objects) = (5 * count)))
);
--
ALTER TABLE ONLY public.review_order FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_skips (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(10) NOT NULL,
    number integer NOT NULL,
    ai_class_id uuid,
    ai_score smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_review_skips_ai_score CHECK (((ai_score >= 0) AND (ai_score <= 255))),
    CONSTRAINT ck_review_skips_kind CHECK ((kind IN ('region', 'cell'))),
    CONSTRAINT ck_review_skips_number CHECK ((number > 0))
);
--
ALTER TABLE ONLY public.review_skips FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_task_slides (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    "position" integer NOT NULL,
    result_set_id uuid,
    kind character varying(10) DEFAULT 'review'::character varying NOT NULL,
    run_set_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    signed_off_at timestamp with time zone,
    signed_off_by_user_id uuid,
    CONSTRAINT ck_review_task_slides_result_set CHECK ((((kind)::text = 'annotate'::text) OR (result_set_id IS NOT NULL))),
    CONSTRAINT ck_review_task_slides_run_sets CHECK ((((kind)::text = 'annotate'::text) OR (cardinality(run_set_ids) = 0))),
    CONSTRAINT ck_review_task_slides_slide_sign_off CHECK ((((kind)::text = 'annotate'::text) OR (signed_off_at IS NULL)))
);
--
ALTER TABLE ONLY public.review_task_slides FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.review_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    name character varying(120) NOT NULL,
    split character varying(10) NOT NULL,
    scope character varying(20) NOT NULL,
    scope_count integer,
    scope_seed bigint,
    scope_score smallint,
    opinion_form_version smallint NOT NULL,
    blinded boolean DEFAULT true NOT NULL,
    ai_hidden_first_read boolean DEFAULT false NOT NULL,
    start_mode character varying(10) NOT NULL,
    due_on date,
    reminder_days smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    created_by_user_id uuid,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_off_at timestamp with time zone,
    signed_off_by_user_id uuid,
    study_template_id uuid,
    study_template_version smallint,
    extra_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    decision_style character varying(10) DEFAULT 'certainty'::character varying NOT NULL,
    counts_as character varying(10)[] DEFAULT '{disagree,disagree,unsure,agree,agree}'::character varying[] NOT NULL,
    counts_as_changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    question character varying(200),
    display jsonb DEFAULT '{}'::jsonb NOT NULL,
    kind character varying(10) DEFAULT 'review'::character varying NOT NULL,
    class_snapshot jsonb,
    check_options jsonb,
    blind_first boolean DEFAULT false NOT NULL,
    report_layout jsonb,
    blind_first_since timestamp with time zone,
    CONSTRAINT ck_review_tasks_blind_first CHECK ((((kind)::text = 'annotate'::text) OR (NOT blind_first))),
    CONSTRAINT ck_review_tasks_cells_below_score CHECK ((((scope)::text = 'cells-below-score'::text) = (scope_score IS NOT NULL))),
    CONSTRAINT ck_review_tasks_check_options CHECK ((((kind)::text = 'annotate'::text) OR (check_options IS NULL))),
    CONSTRAINT ck_review_tasks_class_snapshot CHECK ((((kind)::text = 'annotate'::text) = (class_snapshot IS NOT NULL))),
    CONSTRAINT ck_review_tasks_counts_as CHECK (((cardinality(counts_as) = 5) AND (counts_as <@ ARRAY['agree'::character varying, 'disagree'::character varying, 'unsure'::character varying]) AND ('agree'::text = ANY ((counts_as)::text[])) AND ('disagree'::text = ANY ((counts_as)::text[])))),
    CONSTRAINT ck_review_tasks_decision_style CHECK ((decision_style IN ('certainty', 'agree', 'yes-no', 'blind'))),
    CONSTRAINT ck_review_tasks_kind CHECK ((kind IN ('review', 'annotate'))),
    CONSTRAINT ck_review_tasks_number CHECK ((number > 0)),
    CONSTRAINT ck_review_tasks_random_cells CHECK ((((scope)::text = 'random-cells'::text) = ((scope_count IS NOT NULL) AND (scope_seed IS NOT NULL)))),
    CONSTRAINT ck_review_tasks_reminders CHECK ((cardinality(reminder_days) <= 3)),
    CONSTRAINT ck_review_tasks_scope CHECK ((scope IN ('all-regions', 'random-cells', 'cells-below-score', 'inside-rois', 'unsure-zones', 'whole-slide'))),
    CONSTRAINT ck_review_tasks_scope_count CHECK (((scope_count IS NULL) OR ((scope_count >= 1) AND (scope_count <= 10000)))),
    CONSTRAINT ck_review_tasks_scope_score CHECK (((scope_score IS NULL) OR ((scope_score >= 0) AND (scope_score <= 255)))),
    CONSTRAINT ck_review_tasks_split CHECK ((split IN ('everyone', 'even', 'chosen'))),
    CONSTRAINT ck_review_tasks_start_mode CHECK ((start_mode IN ('guided', 'viewer'))),
    CONSTRAINT ck_review_tasks_study_template CHECK (((study_template_id IS NULL) = (study_template_version IS NULL))),
    CONSTRAINT ck_review_tasks_whole_slide CHECK ((((kind)::text = 'annotate'::text) = ((scope)::text = 'whole-slide'::text)))
);
--
ALTER TABLE ONLY public.review_tasks FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.service_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    scopes character varying(40)[] NOT NULL,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_service_accounts_scopes CHECK (((scopes <@ ARRAY['see-slides'::character varying, 'create-cases'::character varying, 'upload-slides'::character varying, 'see-people'::character varying]) AND (cardinality(scopes) > 0)))
);
--
ALTER TABLE ONLY public.service_accounts FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.session_policies (
    tenant_id uuid NOT NULL,
    idle_lock_minutes smallint NOT NULL,
    session_hours smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    emergency_hours smallint DEFAULT '4'::smallint NOT NULL,
    CONSTRAINT ck_session_policies_emergency_hours CHECK (((emergency_hours >= 1) AND (emergency_hours <= 24))),
    CONSTRAINT ck_session_policies_idle_lock_minutes CHECK (((idle_lock_minutes >= 1) AND (idle_lock_minutes <= 240))),
    CONSTRAINT ck_session_policies_session_hours CHECK (((session_hours >= 1) AND (session_hours <= 24)))
);
--
ALTER TABLE ONLY public.session_policies FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.sessions (
    id_hash bytea NOT NULL,
    subject character varying(200) NOT NULL,
    tokens bytea NOT NULL,
    access_expires_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    active_tenant_id uuid,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    active_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent character varying(200)
);
--
ALTER TABLE ONLY public.sessions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.site_validations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    model_name character varying(80) NOT NULL,
    model_version character varying(40) NOT NULL,
    specimen_type character varying(80) NOT NULL,
    threshold double precision NOT NULL,
    true_positives integer NOT NULL,
    false_positives integer NOT NULL,
    true_negatives integer NOT NULL,
    false_negatives integer NOT NULL,
    announcement_id uuid NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_site_validations_counts CHECK ((LEAST(true_positives, false_positives, true_negatives, false_negatives) >= 0)),
    CONSTRAINT ck_site_validations_threshold CHECK (((threshold >= (0)::double precision) AND (threshold <= (1)::double precision)))
);
--
ALTER TABLE ONLY public.site_validations FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.slide_counters (
    tenant_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    letter character varying(1) NOT NULL,
    last integer NOT NULL,
    CONSTRAINT ck_slide_counters_last CHECK ((last >= 0)),
    CONSTRAINT ck_slide_counters_letter CHECK ((letter IN ('T', 'C', 'R', 'Z', 'M', 'A', 'N')))
);
--
ALTER TABLE ONLY public.slide_counters FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.slide_coverage (
    tenant_id uuid NOT NULL,
    slide_id uuid NOT NULL,
    user_id uuid NOT NULL,
    cell integer NOT NULL,
    columns integer NOT NULL,
    rows integer NOT NULL,
    seen bytea NOT NULL,
    seen_cells integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.slide_coverage FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.slides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    case_id uuid,
    block_id uuid,
    label character varying(200) NOT NULL,
    barcode character varying(100),
    stain character varying(60) DEFAULT 'H&E'::character varying NOT NULL,
    level smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    upload_id uuid,
    format character varying(30),
    variant character varying(30),
    reader character varying(20),
    width integer,
    height integer,
    level_count smallint,
    mpp_x double precision,
    mpp_y double precision,
    objective_power double precision,
    file_bytes bigint,
    sha256 character varying(64),
    original_key character varying(300),
    published_at timestamp with time zone,
    notices character varying(40)[] DEFAULT '{}'::character varying[] NOT NULL,
    restricted_images character varying(10)[] DEFAULT '{}'::character varying[] NOT NULL,
    label_lower text GENERATED ALWAYS AS (lower((label)::text)) STORED NOT NULL,
    "position" smallint,
    CONSTRAINT ck_slides_block_in_case CHECK (((block_id IS NULL) OR (case_id IS NOT NULL))),
    CONSTRAINT ck_slides_uploaded_file CHECK (((upload_id IS NULL) OR (original_key IS NOT NULL)))
);
--
ALTER TABLE ONLY public.slides FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.specimens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    letter character varying(2) NOT NULL,
    type character varying(200),
    site character varying(200),
    laterality character varying(20) DEFAULT 'unknown'::character varying NOT NULL,
    procedure character varying(200),
    collected_at timestamp with time zone,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_specimens_laterality CHECK ((laterality IN ('left', 'right', 'bilateral', 'not-applicable', 'unknown'))),
    CONSTRAINT ck_specimens_letter CHECK (((letter)::text ~ '^[A-Z]{1,2}$'::text))
);
--
ALTER TABLE ONLY public.specimens FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.stage_throughput (
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    ordinal smallint NOT NULL,
    run integer NOT NULL,
    kind character varying(40) NOT NULL,
    stage character varying(40) NOT NULL,
    model character varying(80),
    model_version character varying(40),
    tier character varying(20),
    machine character varying(80) NOT NULL,
    worker character varying(80) NOT NULL,
    units integer NOT NULL,
    seconds double precision NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.stage_throughput FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.study_template_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    template_id uuid NOT NULL,
    version smallint NOT NULL,
    name character varying(120) NOT NULL,
    study_kind character varying(20) NOT NULL,
    blocks jsonb NOT NULL,
    format jsonb NOT NULL,
    presets jsonb NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_study_template_versions_study_kind CHECK ((study_kind IN ('regions-and-cells', 'regions', 'outlines', 'cells', 'reviewers-first', 'other'))),
    CONSTRAINT ck_study_template_versions_version CHECK ((version >= 1))
);
--
ALTER TABLE ONLY public.study_template_versions FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.study_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    built_in character varying(20),
    version smallint NOT NULL,
    retired_at timestamp with time zone,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_study_templates_built_in CHECK ((built_in IN ('sentinel-node', 'detection', 'segmentation', 'cell-typing', 'reader-study'))),
    CONSTRAINT ck_study_templates_version CHECK ((version >= 1))
);
--
ALTER TABLE ONLY public.study_templates FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.task_nudges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sent_by_user_id uuid,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.task_nudges FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.task_reassignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    task_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    what character varying(12) NOT NULL,
    slide_ids uuid[] NOT NULL,
    kept_slide_ids uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    CONSTRAINT ck_task_reassignments_two_people CHECK ((from_user_id <> to_user_id)),
    CONSTRAINT ck_task_reassignments_what CHECK ((what IN ('not-started', 'all')))
);
--
ALTER TABLE ONLY public.task_reassignments FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.template_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    study_kind character varying(20) NOT NULL,
    blocks jsonb NOT NULL,
    format jsonb NOT NULL,
    presets jsonb NOT NULL,
    offered_by_user_id uuid NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    template_id uuid,
    decided_at timestamp with time zone,
    decided_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_template_offers_decided_at CHECK ((((status)::text = 'pending'::text) = (decided_at IS NULL))),
    CONSTRAINT ck_template_offers_status CHECK ((status IN ('pending', 'accepted', 'declined'))),
    CONSTRAINT ck_template_offers_study_kind CHECK ((study_kind IN ('regions-and-cells', 'regions', 'outlines', 'cells', 'reviewers-first', 'other')))
);
--
ALTER TABLE ONLY public.template_offers FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.tenant_keys (
    tenant_id uuid NOT NULL,
    purpose character varying(10) NOT NULL,
    version integer NOT NULL,
    master_id character varying(40) NOT NULL,
    wrapped_key bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_tenant_keys_purpose CHECK ((purpose IN ('data', 'index'))),
    CONSTRAINT ck_tenant_keys_version CHECK (((version >= 1) AND (version <= 65535)))
);
--
ALTER TABLE ONLY public.tenant_keys FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organisation_id uuid NOT NULL,
    slug character varying(40) NOT NULL,
    name character varying(200) NOT NULL,
    kind character varying(20) NOT NULL,
    region character varying(10) NOT NULL,
    plan character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    suspended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email_domain character varying(253),
    join_policy character varying(10) DEFAULT 'join'::character varying NOT NULL,
    logo character varying(3),
    logo_colour character varying(7),
    CONSTRAINT ck_tenants_join_policy CHECK ((join_policy IN ('join', 'ask'))),
    CONSTRAINT ck_tenants_kind CHECK ((kind IN ('diagnostic', 'research', 'second-opinion'))),
    CONSTRAINT ck_tenants_logo CHECK (((logo)::text ~ '^[A-Z0-9]{1,3}$'::text)),
    CONSTRAINT ck_tenants_logo_colour CHECK (((logo_colour)::text ~ '^#[0-9a-f]{6}$'::text)),
    CONSTRAINT ck_tenants_plan CHECK (((plan)::text = 'pilot'::text)),
    CONSTRAINT ck_tenants_region CHECK ((region IN ('eu', 'us'))),
    CONSTRAINT ck_tenants_slug CHECK (((slug)::text ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text)),
    CONSTRAINT ck_tenants_status CHECK ((status IN ('active', 'suspended'))),
    CONSTRAINT ck_tenants_suspended_at CHECK ((((status)::text = 'suspended'::text) = (suspended_at IS NOT NULL)))
);
--
ALTER TABLE ONLY public.tenants FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.thread_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body character varying(4000) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--
ALTER TABLE ONLY public.thread_messages FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid,
    slide_id uuid NOT NULL,
    title character varying(120) NOT NULL,
    anchor_kind character varying(10) NOT NULL,
    object_id character varying(30),
    geometry jsonb,
    offset_x double precision,
    offset_y double precision,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by_user_id uuid,
    result_set_id uuid,
    CONSTRAINT ck_threads_anchor_kind CHECK ((anchor_kind IN ('object', 'roi', 'point', 'shape'))),
    CONSTRAINT ck_threads_geometry_anchor CHECK (((anchor_kind IN ('point', 'shape')) = (geometry IS NOT NULL))),
    CONSTRAINT ck_threads_object_anchor CHECK (((anchor_kind IN ('object', 'roi')) = (object_id IS NOT NULL))),
    CONSTRAINT ck_threads_offset CHECK (((offset_x IS NULL) = (offset_y IS NULL))),
    CONSTRAINT ck_threads_resolved CHECK (((resolved_at IS NULL) = (resolved_by_user_id IS NULL)))
);
--
ALTER TABLE ONLY public.threads FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.uploads (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    case_id uuid,
    created_by_user_id uuid,
    created_by_service_id uuid,
    file_name character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    last_modified_ms bigint,
    object_key character varying(512) NOT NULL,
    storage_upload_id character varying(1024) NOT NULL,
    part_bytes bigint NOT NULL,
    part_count integer NOT NULL,
    status character varying(10) DEFAULT 'open'::character varying NOT NULL,
    etag character varying(80),
    job_id uuid,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind character varying(10) DEFAULT 'slide'::character varying NOT NULL,
    result_format character varying(20),
    slide_id uuid,
    slide_upload_id uuid,
    pairing_rule character varying(30),
    pairing_certainty character varying(10),
    result_set_id uuid,
    import_problems jsonb,
    import_choices jsonb,
    CONSTRAINT ck_uploads_closed CHECK ((((status)::text = 'open'::text) = (closed_at IS NULL))),
    CONSTRAINT ck_uploads_completed_job CHECK ((((job_id IS NULL) OR ((status)::text = 'completed'::text)) AND (((kind)::text = 'result'::text) OR ((status)::text <> 'completed'::text) OR (job_id IS NOT NULL)))),
    CONSTRAINT ck_uploads_created_by CHECK (((created_by_user_id IS NULL) <> (created_by_service_id IS NULL))),
    CONSTRAINT ck_uploads_imported_on_slide CHECK (((result_set_id IS NULL) OR (slide_id IS NOT NULL))),
    CONSTRAINT ck_uploads_kind CHECK ((kind IN ('slide', 'result'))),
    CONSTRAINT ck_uploads_not_itself CHECK (((slide_upload_id IS NULL) OR (slide_upload_id <> id))),
    CONSTRAINT ck_uploads_paired_with CHECK (((pairing_rule IS NULL) OR (slide_id IS NOT NULL) OR (slide_upload_id IS NOT NULL))),
    CONSTRAINT ck_uploads_pairing CHECK (((pairing_rule IS NULL) = (pairing_certainty IS NULL))),
    CONSTRAINT ck_uploads_pairing_certainty CHECK ((pairing_certainty IN ('sure', 'likely'))),
    CONSTRAINT ck_uploads_pairing_rule CHECK ((pairing_rule IN ('next-to-slide', 'folder-named-like-slide', 'file-name', 'embedded-id', 'picked'))),
    CONSTRAINT ck_uploads_part_bytes CHECK ((part_bytes >= 5242880)),
    CONSTRAINT ck_uploads_part_count CHECK (((part_count >= 1) AND (part_count <= 10000))),
    CONSTRAINT ck_uploads_result_format CHECK ((result_format IN ('geojson', 'parfocal-json', 'csv', 'heatmap'))),
    CONSTRAINT ck_uploads_size_bytes CHECK ((size_bytes > 0)),
    CONSTRAINT ck_uploads_slide_fields CHECK ((((kind)::text = 'result'::text) OR ((result_format IS NULL) AND (slide_id IS NULL) AND (slide_upload_id IS NULL) AND (pairing_rule IS NULL) AND (result_set_id IS NULL)))),
    CONSTRAINT ck_uploads_status CHECK ((status IN ('open', 'completed', 'aborted', 'expired')))
);
--
ALTER TABLE ONLY public.uploads FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject character varying(200) NOT NULL,
    email character varying(320),
    display_name character varying(200) NOT NULL,
    initials character varying(3) NOT NULL,
    avatar_colour smallint NOT NULL,
    title character varying(40),
    last_tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email_digest character varying(10) DEFAULT 'off'::character varying NOT NULL,
    quiet_from time without time zone,
    quiet_until time without time zone,
    time_zone character varying(60) DEFAULT 'UTC'::character varying NOT NULL,
    specialties character varying(60)[] DEFAULT '{}'::character varying[] NOT NULL,
    CONSTRAINT ck_users_avatar_colour CHECK (((avatar_colour >= 0) AND (avatar_colour <= 11))),
    CONSTRAINT ck_users_email_digest CHECK ((email_digest IN ('off', 'hourly', 'daily'))),
    CONSTRAINT ck_users_initials CHECK (((initials)::text ~ '^[A-Z]{1,3}$'::text)),
    CONSTRAINT ck_users_quiet_hours CHECK (((quiet_from IS NULL) = (quiet_until IS NULL)))
);
--
ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.workspace_access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    asked_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by_user_id uuid,
    CONSTRAINT ck_workspace_access_requests_decided_at CHECK ((((status)::text = 'pending'::text) = (decided_at IS NULL))),
    CONSTRAINT ck_workspace_access_requests_status CHECK ((status IN ('pending', 'approved')))
);
--
ALTER TABLE ONLY public.workspace_access_requests FORCE ROW LEVEL SECURITY;
--
CREATE TABLE public.workspace_settings (
    tenant_id uuid NOT NULL,
    "values" jsonb DEFAULT '{}'::jsonb NOT NULL,
    locked character varying(40)[] DEFAULT '{}'::character varying[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    security_contact character varying(320)
);
--
ALTER TABLE ONLY public.workspace_settings FORCE ROW LEVEL SECURITY;
--
ALTER TABLE ONLY public.adjudication_objects
    ADD CONSTRAINT pk_adjudication_objects PRIMARY KEY (adjudication_id, slide_id, kind, number);
--
ALTER TABLE ONLY public.adjudications
    ADD CONSTRAINT pk_adjudications PRIMARY KEY (id);
--
ALTER TABLE ONLY public.annotation_versions
    ADD CONSTRAINT pk_annotation_versions PRIMARY KEY (annotation_id, version);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT pk_annotations PRIMARY KEY (id);
--
ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT pk_announcements PRIMARY KEY (id);
--
ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT pk_api_tokens PRIMARY KEY (id);
--
ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT pk_audit_events PRIMARY KEY (id);
--
ALTER TABLE ONLY public.audit_people
    ADD CONSTRAINT pk_audit_people PRIMARY KEY (id);
--
ALTER TABLE ONLY public.auth_logins
    ADD CONSTRAINT pk_auth_logins PRIMARY KEY (state_hash);
--
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT pk_blocks PRIMARY KEY (id);
--
ALTER TABLE ONLY public.case_requests
    ADD CONSTRAINT pk_case_requests PRIMARY KEY (tenant_id, user_id, request_key);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT pk_cases PRIMARY KEY (id);
--
ALTER TABLE ONLY public.class_mappings
    ADD CONSTRAINT pk_class_mappings PRIMARY KEY (project_id, source_name);
--
ALTER TABLE ONLY public.clinical_deposits
    ADD CONSTRAINT pk_clinical_deposits PRIMARY KEY (id);
--
ALTER TABLE ONLY public.clinical_report_versions
    ADD CONSTRAINT pk_clinical_report_versions PRIMARY KEY (id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT pk_clinical_reports PRIMARY KEY (id);
--
ALTER TABLE ONLY public.disagreement_decisions
    ADD CONSTRAINT pk_disagreement_decisions PRIMARY KEY (task_id, slide_id, kind, number);
--
ALTER TABLE ONLY public.display_choices
    ADD CONSTRAINT pk_display_choices PRIMARY KEY (task_id, user_id);
--
ALTER TABLE ONLY public.display_presets
    ADD CONSTRAINT pk_display_presets PRIMARY KEY (id);
--
ALTER TABLE ONLY public.emergency_grants
    ADD CONSTRAINT pk_emergency_grants PRIMARY KEY (id);
--
ALTER TABLE ONLY public.evaluation_changes
    ADD CONSTRAINT pk_evaluation_changes PRIMARY KEY (id);
--
ALTER TABLE ONLY public.evaluation_versions
    ADD CONSTRAINT pk_evaluation_versions PRIMARY KEY (id);
--
ALTER TABLE ONLY public.gpu_usage
    ADD CONSTRAINT pk_gpu_usage PRIMARY KEY (id);
--
ALTER TABLE ONLY public.hidden_models
    ADD CONSTRAINT pk_hidden_models PRIMARY KEY (id);
--
ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT pk_invitations PRIMARY KEY (id);
--
ALTER TABLE ONLY public.job_steps
    ADD CONSTRAINT pk_job_steps PRIMARY KEY (job_id, ordinal);
--
ALTER TABLE ONLY public.job_units
    ADD CONSTRAINT pk_job_units PRIMARY KEY (job_id, ordinal, unit);
--
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT pk_jobs PRIMARY KEY (id);
--
ALTER TABLE ONLY public.lab_model_projects
    ADD CONSTRAINT pk_lab_model_projects PRIMARY KEY (lab_model_id, project_id);
--
ALTER TABLE ONLY public.lab_models
    ADD CONSTRAINT pk_lab_models PRIMARY KEY (id);
--
ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT pk_legal_holds PRIMARY KEY (id);
--
ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT pk_memberships PRIMARY KEY (id);
--
ALTER TABLE ONLY public.model_runs
    ADD CONSTRAINT pk_model_runs PRIMARY KEY (job_id);
--
ALTER TABLE ONLY public.model_tiers
    ADD CONSTRAINT pk_model_tiers PRIMARY KEY (id);
--
ALTER TABLE ONLY public.notification_mutes
    ADD CONSTRAINT pk_notification_mutes PRIMARY KEY (tenant_id, user_id, subject, subject_id);
--
ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT pk_notification_preferences PRIMARY KEY (tenant_id, user_id, kind);
--
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT pk_notifications PRIMARY KEY (id);
--
ALTER TABLE ONLY public.opinion_forms
    ADD CONSTRAINT pk_opinion_forms PRIMARY KEY (id);
--
ALTER TABLE ONLY public.opinions
    ADD CONSTRAINT pk_opinions PRIMARY KEY (task_id, slide_id, user_id);
--
ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT pk_organisations PRIMARY KEY (id);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT pk_patients PRIMARY KEY (id);
--
ALTER TABLE ONLY public.personal_settings
    ADD CONSTRAINT pk_personal_settings PRIMARY KEY (tenant_id, user_id);
--
ALTER TABLE ONLY public.platform_operators
    ADD CONSTRAINT pk_platform_operators PRIMARY KEY (subject);
--
ALTER TABLE ONLY public.project_classes
    ADD CONSTRAINT pk_project_classes PRIMARY KEY (id);
--
ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT pk_project_members PRIMARY KEY (project_id, user_id);
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT pk_projects PRIMARY KEY (id);
--
ALTER TABLE ONLY public.rate_counters
    ADD CONSTRAINT pk_rate_counters PRIMARY KEY (key, window_start);
--
ALTER TABLE ONLY public.registered_models
    ADD CONSTRAINT pk_registered_models PRIMARY KEY (id);
--
ALTER TABLE ONLY public.report_links
    ADD CONSTRAINT pk_report_links PRIMARY KEY (id);
--
ALTER TABLE ONLY public.result_chunks
    ADD CONSTRAINT pk_result_chunks PRIMARY KEY (result_set_id, chunk);
--
ALTER TABLE ONLY public.result_objects
    ADD CONSTRAINT pk_result_objects PRIMARY KEY (result_set_id, kind, number);
--
ALTER TABLE ONLY public.result_set_classes
    ADD CONSTRAINT pk_result_set_classes PRIMARY KEY (result_set_id, "position");
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT pk_result_sets PRIMARY KEY (id);
--
ALTER TABLE ONLY public.resume_states
    ADD CONSTRAINT pk_resume_states PRIMARY KEY (tenant_id, user_id);
--
ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT pk_retention_policies PRIMARY KEY (tenant_id);
--
ALTER TABLE ONLY public.review_assignments
    ADD CONSTRAINT pk_review_assignments PRIMARY KEY (task_id, slide_id, user_id);
--
ALTER TABLE ONLY public.review_decisions
    ADD CONSTRAINT pk_review_decisions PRIMARY KEY (task_id, slide_id, user_id, kind, number);
--
ALTER TABLE ONLY public.review_edits
    ADD CONSTRAINT pk_review_edits PRIMARY KEY (task_id, slide_id, user_id, kind, number, split);
--
ALTER TABLE ONLY public.review_order
    ADD CONSTRAINT pk_review_order PRIMARY KEY (task_id, slide_id);
--
ALTER TABLE ONLY public.review_skips
    ADD CONSTRAINT pk_review_skips PRIMARY KEY (task_id, slide_id, user_id, kind, number);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT pk_review_task_slides PRIMARY KEY (task_id, slide_id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT pk_review_tasks PRIMARY KEY (id);
--
ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT pk_service_accounts PRIMARY KEY (id);
--
ALTER TABLE ONLY public.session_policies
    ADD CONSTRAINT pk_session_policies PRIMARY KEY (tenant_id);
--
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT pk_sessions PRIMARY KEY (id_hash);
--
ALTER TABLE ONLY public.site_validations
    ADD CONSTRAINT pk_site_validations PRIMARY KEY (id);
--
ALTER TABLE ONLY public.slide_counters
    ADD CONSTRAINT pk_slide_counters PRIMARY KEY (slide_id, letter);
--
ALTER TABLE ONLY public.slide_coverage
    ADD CONSTRAINT pk_slide_coverage PRIMARY KEY (slide_id, user_id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT pk_slides PRIMARY KEY (id);
--
ALTER TABLE ONLY public.specimens
    ADD CONSTRAINT pk_specimens PRIMARY KEY (id);
--
ALTER TABLE ONLY public.stage_throughput
    ADD CONSTRAINT pk_stage_throughput PRIMARY KEY (job_id, ordinal, run);
--
ALTER TABLE ONLY public.study_template_versions
    ADD CONSTRAINT pk_study_template_versions PRIMARY KEY (id);
--
ALTER TABLE ONLY public.study_templates
    ADD CONSTRAINT pk_study_templates PRIMARY KEY (id);
--
ALTER TABLE ONLY public.task_nudges
    ADD CONSTRAINT pk_task_nudges PRIMARY KEY (id);
--
ALTER TABLE ONLY public.task_reassignments
    ADD CONSTRAINT pk_task_reassignments PRIMARY KEY (id);
--
ALTER TABLE ONLY public.template_offers
    ADD CONSTRAINT pk_template_offers PRIMARY KEY (id);
--
ALTER TABLE ONLY public.tenant_keys
    ADD CONSTRAINT pk_tenant_keys PRIMARY KEY (tenant_id, purpose, version);
--
ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT pk_tenants PRIMARY KEY (id);
--
ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT pk_thread_messages PRIMARY KEY (id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT pk_threads PRIMARY KEY (id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT pk_uploads PRIMARY KEY (id);
--
ALTER TABLE ONLY public.users
    ADD CONSTRAINT pk_users PRIMARY KEY (id);
--
ALTER TABLE ONLY public.workspace_access_requests
    ADD CONSTRAINT pk_workspace_access_requests PRIMARY KEY (id);
--
ALTER TABLE ONLY public.workspace_settings
    ADD CONSTRAINT pk_workspace_settings PRIMARY KEY (tenant_id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT uq_annotations_slide_id_kind_number UNIQUE (slide_id, kind, number);
--
ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT uq_api_tokens_token_hash UNIQUE (token_hash);
--
ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT uq_audit_events_tenant_id_seq UNIQUE NULLS NOT DISTINCT (tenant_id, seq);
--
ALTER TABLE ONLY public.audit_people
    ADD CONSTRAINT uq_audit_people_subject UNIQUE (subject);
--
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT uq_blocks_id_case_id UNIQUE (id, case_id);
--
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT uq_blocks_specimen_id_number UNIQUE (specimen_id, number);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT uq_cases_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT uq_cases_id_tenant_id UNIQUE (id, tenant_id);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT uq_cases_project_id_label UNIQUE (project_id, label);
--
ALTER TABLE ONLY public.clinical_report_versions
    ADD CONSTRAINT uq_clinical_report_versions_report_id_number UNIQUE (report_id, number);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT uq_clinical_reports_case_id UNIQUE (case_id);
--
ALTER TABLE ONLY public.evaluation_versions
    ADD CONSTRAINT uq_evaluation_versions_task_id_number UNIQUE (task_id, number);
--
ALTER TABLE ONLY public.hidden_models
    ADD CONSTRAINT uq_hidden_models_tenant_id_model_name UNIQUE (tenant_id, model_name);
--
ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT uq_invitations_token_hash UNIQUE (token_hash);
--
ALTER TABLE ONLY public.lab_models
    ADD CONSTRAINT uq_lab_models_tenant_id_name_version UNIQUE (tenant_id, name, version);
--
ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT uq_memberships_tenant_id_user_id UNIQUE (tenant_id, user_id);
--
ALTER TABLE ONLY public.model_tiers
    ADD CONSTRAINT uq_model_tiers_tenant_id_task_tier UNIQUE (tenant_id, task, tier);
--
ALTER TABLE ONLY public.opinion_forms
    ADD CONSTRAINT uq_opinion_forms_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.opinion_forms
    ADD CONSTRAINT uq_opinion_forms_project_id_version UNIQUE (project_id, version);
--
ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT uq_organisations_slug UNIQUE (slug);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT uq_patients_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT uq_patients_id_tenant_id UNIQUE (id, tenant_id);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT uq_patients_project_id_mrn_index UNIQUE (project_id, mrn_index);
--
ALTER TABLE ONLY public.project_classes
    ADD CONSTRAINT uq_project_classes_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.project_classes
    ADD CONSTRAINT uq_project_classes_project_id_key UNIQUE (project_id, key) DEFERRABLE INITIALLY DEFERRED;
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uq_projects_id_privacy_mode UNIQUE (id, privacy_mode);
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uq_projects_id_tenant_id UNIQUE (id, tenant_id);
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uq_projects_tenant_id_number UNIQUE (tenant_id, number);
--
ALTER TABLE ONLY public.registered_models
    ADD CONSTRAINT uq_registered_models_name_version UNIQUE (name, version);
--
ALTER TABLE ONLY public.report_links
    ADD CONSTRAINT uq_report_links_token_hash UNIQUE (token_hash);
--
ALTER TABLE ONLY public.result_set_classes
    ADD CONSTRAINT uq_result_set_classes_result_set_id_source_name UNIQUE (result_set_id, source_name);
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT uq_result_sets_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT uq_review_task_slides_task_id_position UNIQUE (task_id, "position");
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT uq_review_tasks_id_kind UNIQUE (id, kind);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT uq_review_tasks_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT uq_review_tasks_project_id_number UNIQUE (project_id, number);
--
ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT uq_service_accounts_tenant_id_name UNIQUE (tenant_id, name);
--
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT uq_sessions_id UNIQUE (id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT uq_slides_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT uq_slides_project_id_barcode UNIQUE (project_id, barcode);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT uq_slides_upload_id UNIQUE (upload_id);
--
ALTER TABLE ONLY public.specimens
    ADD CONSTRAINT uq_specimens_case_id_letter UNIQUE (case_id, letter);
--
ALTER TABLE ONLY public.specimens
    ADD CONSTRAINT uq_specimens_id_case_id_tenant_id UNIQUE (id, case_id, tenant_id);
--
ALTER TABLE ONLY public.study_template_versions
    ADD CONSTRAINT uq_study_template_versions_template_id_version UNIQUE (template_id, version);
--
ALTER TABLE ONLY public.study_template_versions
    ADD CONSTRAINT uq_study_template_versions_template_id_version_tenant_id UNIQUE (template_id, version, tenant_id);
--
ALTER TABLE ONLY public.study_templates
    ADD CONSTRAINT uq_study_templates_id_tenant_id UNIQUE (id, tenant_id);
--
ALTER TABLE ONLY public.study_templates
    ADD CONSTRAINT uq_study_templates_tenant_id_built_in UNIQUE (tenant_id, built_in);
--
ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT uq_tenants_slug UNIQUE (slug);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uq_uploads_id_project_id UNIQUE (id, project_id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uq_uploads_object_key UNIQUE (object_key);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uq_uploads_result_set_id UNIQUE (result_set_id);
--
ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_subject UNIQUE (subject);
--
CREATE INDEX ix_adjudication_objects_task_id ON public.adjudication_objects USING btree (task_id);
--
CREATE INDEX ix_adjudication_objects_tenant_id ON public.adjudication_objects USING btree (tenant_id);
--
CREATE INDEX ix_adjudications_adjudicator_user_id ON public.adjudications USING btree (adjudicator_user_id);
--
CREATE INDEX ix_adjudications_task_id ON public.adjudications USING btree (task_id);
--
CREATE INDEX ix_adjudications_tenant_id ON public.adjudications USING btree (tenant_id);
--
CREATE INDEX ix_annotation_versions_tenant_id ON public.annotation_versions USING btree (tenant_id);
--
CREATE INDEX ix_annotations_geometry ON public.annotations USING gist (geometry);
--
CREATE INDEX ix_annotations_slide_id ON public.annotations USING btree (slide_id);
--
CREATE INDEX ix_annotations_task_id ON public.annotations USING btree (task_id);
--
CREATE INDEX ix_annotations_tenant_id ON public.annotations USING btree (tenant_id);
--
CREATE INDEX ix_announcements_tenant_id ON public.announcements USING btree (tenant_id);
--
CREATE INDEX ix_announcements_tenant_id_created_at ON public.announcements USING btree (tenant_id, created_at);
--
CREATE INDEX ix_api_tokens_service_account_id ON public.api_tokens USING btree (service_account_id);
--
CREATE INDEX ix_api_tokens_tenant_id ON public.api_tokens USING btree (tenant_id);
--
CREATE INDEX ix_audit_events_tenant_id_target_type_target_id ON public.audit_events USING btree (tenant_id, target_type, target_id);
--
CREATE INDEX ix_auth_logins_expires_at ON public.auth_logins USING btree (expires_at);
--
CREATE INDEX ix_blocks_case_id ON public.blocks USING btree (case_id);
--
CREATE INDEX ix_blocks_specimen_id ON public.blocks USING btree (specimen_id);
--
CREATE INDEX ix_blocks_tenant_id ON public.blocks USING btree (tenant_id);
--
CREATE INDEX ix_cases_patient_id ON public.cases USING btree (patient_id);
--
CREATE INDEX ix_cases_project_id ON public.cases USING btree (project_id);
--
CREATE INDEX ix_cases_tenant_id ON public.cases USING btree (tenant_id);
--
CREATE INDEX ix_class_mappings_tenant_id ON public.class_mappings USING btree (tenant_id);
--
CREATE INDEX ix_clinical_deposits_report_id ON public.clinical_deposits USING btree (report_id);
--
CREATE INDEX ix_clinical_deposits_tenant_id ON public.clinical_deposits USING btree (tenant_id);
--
CREATE INDEX ix_clinical_report_versions_report_id ON public.clinical_report_versions USING btree (report_id);
--
CREATE INDEX ix_clinical_report_versions_tenant_id ON public.clinical_report_versions USING btree (tenant_id);
--
CREATE INDEX ix_clinical_reports_project_id ON public.clinical_reports USING btree (project_id);
--
CREATE INDEX ix_clinical_reports_tenant_id ON public.clinical_reports USING btree (tenant_id);
--
CREATE INDEX ix_disagreement_decisions_tenant_id ON public.disagreement_decisions USING btree (tenant_id);
--
CREATE INDEX ix_display_choices_tenant_id ON public.display_choices USING btree (tenant_id);
--
CREATE INDEX ix_display_presets_tenant_id ON public.display_presets USING btree (tenant_id);
--
CREATE UNIQUE INDEX ix_display_presets_tenant_id_user_id_name ON public.display_presets USING btree (tenant_id, user_id, lower((name)::text));
--
CREATE INDEX ix_emergency_grants_tenant_id ON public.emergency_grants USING btree (tenant_id);
--
CREATE INDEX ix_emergency_grants_user_id_project_id ON public.emergency_grants USING btree (user_id, project_id);
--
CREATE INDEX ix_evaluation_changes_task_id ON public.evaluation_changes USING btree (task_id);
--
CREATE INDEX ix_evaluation_changes_tenant_id ON public.evaluation_changes USING btree (tenant_id);
--
CREATE INDEX ix_evaluation_versions_task_id ON public.evaluation_versions USING btree (task_id);
--
CREATE INDEX ix_evaluation_versions_tenant_id ON public.evaluation_versions USING btree (tenant_id);
--
CREATE INDEX ix_gpu_usage_job_id ON public.gpu_usage USING btree (job_id);
--
CREATE INDEX ix_gpu_usage_tenant_id ON public.gpu_usage USING btree (tenant_id);
--
CREATE INDEX ix_gpu_usage_tenant_id_recorded_at ON public.gpu_usage USING btree (tenant_id, recorded_at);
--
CREATE INDEX ix_hidden_models_tenant_id ON public.hidden_models USING btree (tenant_id);
--
CREATE INDEX ix_invitations_task_id ON public.invitations USING btree (task_id);
--
CREATE INDEX ix_invitations_tenant_id ON public.invitations USING btree (tenant_id);
--
CREATE INDEX ix_job_steps_tenant_id ON public.job_steps USING btree (tenant_id);
--
CREATE INDEX ix_job_units_job_id_seq ON public.job_units USING btree (job_id, seq);
--
CREATE INDEX ix_job_units_tenant_id ON public.job_units USING btree (tenant_id);
--
CREATE INDEX ix_jobs_claimable ON public.jobs USING btree (created_at) WHERE (status IN ('queued', 'running'));
--
CREATE INDEX ix_jobs_tenant_id ON public.jobs USING btree (tenant_id);
--
CREATE INDEX ix_lab_model_projects_tenant_id ON public.lab_model_projects USING btree (tenant_id);
--
CREATE INDEX ix_lab_models_tenant_id ON public.lab_models USING btree (tenant_id);
--
CREATE INDEX ix_legal_holds_tenant_id ON public.legal_holds USING btree (tenant_id);
--
CREATE INDEX ix_memberships_tenant_id ON public.memberships USING btree (tenant_id);
--
CREATE INDEX ix_memberships_user_id ON public.memberships USING btree (user_id);
--
CREATE INDEX ix_model_runs_batch_id ON public.model_runs USING btree (batch_id);
--
CREATE INDEX ix_model_runs_project_id_created_at ON public.model_runs USING btree (project_id, created_at);
--
CREATE INDEX ix_model_runs_slide_id ON public.model_runs USING btree (slide_id);
--
CREATE INDEX ix_model_runs_task_id ON public.model_runs USING btree (task_id);
--
CREATE INDEX ix_model_runs_tenant_id ON public.model_runs USING btree (tenant_id);
--
CREATE INDEX ix_model_tiers_tenant_id ON public.model_tiers USING btree (tenant_id);
--
CREATE INDEX ix_notifications_pending_email ON public.notifications USING btree (tenant_id) WHERE ((email_status)::text = 'pending'::text);
--
CREATE INDEX ix_notifications_tenant_id ON public.notifications USING btree (tenant_id);
--
CREATE INDEX ix_notifications_user_id_created_at ON public.notifications USING btree (user_id, created_at);
--
CREATE INDEX ix_notifications_user_id_unread ON public.notifications USING btree (user_id, kind) WHERE (read_at IS NULL);
--
CREATE INDEX ix_opinion_forms_tenant_id ON public.opinion_forms USING btree (tenant_id);
--
CREATE INDEX ix_opinions_tenant_id ON public.opinions USING btree (tenant_id);
--
CREATE INDEX ix_patients_birth_date_index ON public.patients USING btree (project_id, birth_date_index);
--
CREATE INDEX ix_patients_name_tokens ON public.patients USING gin (name_tokens);
--
CREATE INDEX ix_patients_project_id ON public.patients USING btree (project_id);
--
CREATE INDEX ix_patients_tenant_id ON public.patients USING btree (tenant_id);
--
CREATE INDEX ix_project_classes_project_id ON public.project_classes USING btree (project_id);
--
CREATE UNIQUE INDEX ix_project_classes_project_id_name ON public.project_classes USING btree (project_id, lower((name)::text));
--
CREATE INDEX ix_project_classes_tenant_id ON public.project_classes USING btree (tenant_id);
--
CREATE INDEX ix_project_members_user_id ON public.project_members USING btree (user_id);
--
CREATE INDEX ix_projects_tenant_id ON public.projects USING btree (tenant_id);
--
CREATE UNIQUE INDEX ix_projects_tenant_id_sample ON public.projects USING btree (tenant_id) WHERE (sample AND (deleted_at IS NULL));
--
CREATE INDEX ix_report_links_task_id ON public.report_links USING btree (task_id);
--
CREATE INDEX ix_report_links_tenant_id ON public.report_links USING btree (tenant_id);
--
CREATE INDEX ix_result_chunks_tenant_id ON public.result_chunks USING btree (tenant_id);
--
CREATE INDEX ix_result_objects_geometry ON public.result_objects USING gist (geometry);
--
CREATE INDEX ix_result_objects_tenant_id ON public.result_objects USING btree (tenant_id);
--
CREATE INDEX ix_result_set_classes_tenant_id ON public.result_set_classes USING btree (tenant_id);
--
CREATE INDEX ix_result_sets_project_id ON public.result_sets USING btree (project_id);
--
CREATE INDEX ix_result_sets_slide_id ON public.result_sets USING btree (slide_id);
--
CREATE INDEX ix_result_sets_tenant_id ON public.result_sets USING btree (tenant_id);
--
CREATE INDEX ix_review_assignments_tenant_id ON public.review_assignments USING btree (tenant_id);
--
CREATE INDEX ix_review_assignments_user_id ON public.review_assignments USING btree (user_id);
--
CREATE INDEX ix_review_decisions_tenant_id ON public.review_decisions USING btree (tenant_id);
--
CREATE INDEX ix_review_edits_tenant_id ON public.review_edits USING btree (tenant_id);
--
CREATE INDEX ix_review_order_tenant_id ON public.review_order USING btree (tenant_id);
--
CREATE INDEX ix_review_skips_tenant_id ON public.review_skips USING btree (tenant_id);
--
CREATE INDEX ix_review_task_slides_result_set_id ON public.review_task_slides USING btree (result_set_id);
--
CREATE INDEX ix_review_task_slides_slide_id ON public.review_task_slides USING btree (slide_id);
--
CREATE INDEX ix_review_task_slides_tenant_id ON public.review_task_slides USING btree (tenant_id);
--
CREATE INDEX ix_review_tasks_project_id ON public.review_tasks USING btree (project_id);
--
CREATE INDEX ix_review_tasks_tenant_id ON public.review_tasks USING btree (tenant_id);
--
CREATE INDEX ix_service_accounts_tenant_id ON public.service_accounts USING btree (tenant_id);
--
CREATE INDEX ix_sessions_expires_at ON public.sessions USING btree (expires_at);
--
CREATE INDEX ix_sessions_subject ON public.sessions USING btree (subject);
--
CREATE INDEX ix_site_validations_tenant_id ON public.site_validations USING btree (tenant_id);
--
CREATE INDEX ix_site_validations_tenant_id_created_at ON public.site_validations USING btree (tenant_id, created_at);
--
CREATE INDEX ix_slide_counters_tenant_id ON public.slide_counters USING btree (tenant_id);
--
CREATE INDEX ix_slide_coverage_tenant_id ON public.slide_coverage USING btree (tenant_id);
--
CREATE INDEX ix_slides_block_id ON public.slides USING btree (block_id);
--
CREATE INDEX ix_slides_case_id ON public.slides USING btree (case_id);
--
CREATE UNIQUE INDEX ix_slides_case_id_label ON public.slides USING btree (case_id, label) WHERE (deleted_at IS NULL);
--
CREATE INDEX ix_slides_project_id ON public.slides USING btree (project_id);
--
CREATE UNIQUE INDEX ix_slides_project_id_label ON public.slides USING btree (project_id, label) WHERE ((case_id IS NULL) AND (deleted_at IS NULL));
--
CREATE INDEX ix_slides_tenant_id ON public.slides USING btree (tenant_id);
--
CREATE INDEX ix_specimens_case_id ON public.specimens USING btree (case_id);
--
CREATE INDEX ix_specimens_tenant_id ON public.specimens USING btree (tenant_id);
--
CREATE INDEX ix_stage_throughput_model ON public.stage_throughput USING btree (model, model_version, stage);
--
CREATE INDEX ix_stage_throughput_tenant_id ON public.stage_throughput USING btree (tenant_id);
--
CREATE INDEX ix_study_template_versions_tenant_id ON public.study_template_versions USING btree (tenant_id);
--
CREATE INDEX ix_study_templates_tenant_id ON public.study_templates USING btree (tenant_id);
--
CREATE INDEX ix_task_nudges_task_id ON public.task_nudges USING btree (task_id);
--
CREATE INDEX ix_task_nudges_tenant_id ON public.task_nudges USING btree (tenant_id);
--
CREATE INDEX ix_task_reassignments_task_id ON public.task_reassignments USING btree (task_id);
--
CREATE INDEX ix_task_reassignments_tenant_id ON public.task_reassignments USING btree (tenant_id);
--
CREATE INDEX ix_template_offers_tenant_id ON public.template_offers USING btree (tenant_id);
--
CREATE INDEX ix_tenants_email_domain ON public.tenants USING btree (email_domain);
--
CREATE INDEX ix_tenants_organisation_id ON public.tenants USING btree (organisation_id);
--
CREATE INDEX ix_thread_messages_tenant_id ON public.thread_messages USING btree (tenant_id);
--
CREATE INDEX ix_thread_messages_thread_id ON public.thread_messages USING btree (thread_id);
--
CREATE INDEX ix_threads_project_id_slide_id_taskless ON public.threads USING btree (project_id, slide_id) WHERE (task_id IS NULL);
--
CREATE INDEX ix_threads_task_id_slide_id ON public.threads USING btree (task_id, slide_id);
--
CREATE INDEX ix_threads_tenant_id ON public.threads USING btree (tenant_id);
--
CREATE INDEX ix_uploads_open_by_activity ON public.uploads USING btree (last_activity_at) WHERE ((status)::text = 'open'::text);
--
CREATE INDEX ix_uploads_open_by_file ON public.uploads USING btree (project_id, file_name, size_bytes) WHERE ((status)::text = 'open'::text);
--
CREATE INDEX ix_uploads_project_id ON public.uploads USING btree (project_id);
--
CREATE INDEX ix_uploads_slide_upload_id ON public.uploads USING btree (slide_upload_id) WHERE (slide_upload_id IS NOT NULL);
--
CREATE INDEX ix_uploads_tenant_id ON public.uploads USING btree (tenant_id);
--
CREATE INDEX ix_workspace_access_requests_tenant_id ON public.workspace_access_requests USING btree (tenant_id);
--
CREATE UNIQUE INDEX uq_annotations_source ON public.annotations USING btree (task_id, slide_id, kind, source_number) WHERE (source_number IS NOT NULL);
--
CREATE UNIQUE INDEX ux_workspace_access_requests_pending ON public.workspace_access_requests USING btree (tenant_id, user_id) WHERE ((status)::text = 'pending'::text);
--
CREATE TRIGGER annotations_touch_updated_at BEFORE UPDATE ON public.annotations FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER announcements_touch_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER api_tokens_keep_revoked BEFORE UPDATE ON public.api_tokens FOR EACH ROW EXECUTE FUNCTION public.parfocal_keep_token_revoked();
--
CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.parfocal_refuse_audit_change();
--
CREATE TRIGGER audit_events_chain BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.parfocal_chain_audit_event();
--
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.parfocal_refuse_audit_change();
--
CREATE TRIGGER blocks_touch_updated_at BEFORE UPDATE ON public.blocks FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER cases_touch_updated_at BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER class_mappings_touch_updated_at BEFORE UPDATE ON public.class_mappings FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER disagreement_decisions_touch_updated_at BEFORE UPDATE ON public.disagreement_decisions FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER display_choices_touch_updated_at BEFORE UPDATE ON public.display_choices FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER display_presets_touch_updated_at BEFORE UPDATE ON public.display_presets FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER hidden_models_touch_updated_at BEFORE UPDATE ON public.hidden_models FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER lab_models_touch_updated_at BEFORE UPDATE ON public.lab_models FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER legal_holds_touch_updated_at BEFORE UPDATE ON public.legal_holds FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER memberships_touch_updated_at BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER model_tiers_touch_updated_at BEFORE UPDATE ON public.model_tiers FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER notification_preferences_touch_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER opinions_touch_updated_at BEFORE UPDATE ON public.opinions FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER organisations_touch_updated_at BEFORE UPDATE ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER patients_touch_updated_at BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER project_classes_touch_updated_at BEFORE UPDATE ON public.project_classes FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER projects_touch_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER registered_models_touch_updated_at BEFORE UPDATE ON public.registered_models FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER result_chunks_while_importing BEFORE INSERT ON public.result_chunks FOR EACH ROW EXECUTE FUNCTION public.parfocal_result_rows_while_importing();
--
CREATE TRIGGER result_objects_while_importing BEFORE INSERT ON public.result_objects FOR EACH ROW EXECUTE FUNCTION public.parfocal_result_rows_while_importing();
--
CREATE TRIGGER result_set_classes_changes BEFORE UPDATE ON public.result_set_classes FOR EACH ROW EXECUTE FUNCTION public.parfocal_result_class_changes();
--
CREATE TRIGGER result_set_classes_while_importing BEFORE INSERT ON public.result_set_classes FOR EACH ROW EXECUTE FUNCTION public.parfocal_result_rows_while_importing();
--
CREATE TRIGGER result_sets_changes BEFORE UPDATE ON public.result_sets FOR EACH ROW EXECUTE FUNCTION public.parfocal_result_set_changes();
--
CREATE TRIGGER result_sets_touch_updated_at BEFORE UPDATE ON public.result_sets FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER resume_states_touch_updated_at BEFORE UPDATE ON public.resume_states FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER retention_policies_touch_updated_at BEFORE UPDATE ON public.retention_policies FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER review_assignments_first_read_kept BEFORE UPDATE ON public.review_assignments FOR EACH ROW EXECUTE FUNCTION public.parfocal_first_read_kept();
--
CREATE TRIGGER review_decisions_touch_updated_at BEFORE UPDATE ON public.review_decisions FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER review_edits_touch_updated_at BEFORE UPDATE ON public.review_edits FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER review_skips_touch_updated_at BEFORE UPDATE ON public.review_skips FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER review_tasks_touch_updated_at BEFORE UPDATE ON public.review_tasks FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER service_accounts_touch_updated_at BEFORE UPDATE ON public.service_accounts FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER session_policies_touch_updated_at BEFORE UPDATE ON public.session_policies FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER site_validations_touch_updated_at BEFORE UPDATE ON public.site_validations FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER slide_coverage_touch_updated_at BEFORE UPDATE ON public.slide_coverage FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER slides_touch_updated_at BEFORE UPDATE ON public.slides FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER specimens_touch_updated_at BEFORE UPDATE ON public.specimens FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER study_templates_touch_updated_at BEFORE UPDATE ON public.study_templates FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER tenants_touch_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER uploads_touch_updated_at BEFORE UPDATE ON public.uploads FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
CREATE TRIGGER users_guard_identity BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.parfocal_guard_user_identity();
--
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.parfocal_touch_updated_at();
--
ALTER TABLE ONLY public.adjudication_objects
    ADD CONSTRAINT fk_adjudication_objects_adjudication_id_adjudications FOREIGN KEY (adjudication_id) REFERENCES public.adjudications(id);
--
ALTER TABLE ONLY public.adjudication_objects
    ADD CONSTRAINT fk_adjudication_objects_task_id_slide_id_review_task_slides FOREIGN KEY (task_id, slide_id) REFERENCES public.review_task_slides(task_id, slide_id);
--
ALTER TABLE ONLY public.adjudication_objects
    ADD CONSTRAINT fk_adjudication_objects_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.adjudications
    ADD CONSTRAINT fk_adjudications_adjudicator_user_id_users FOREIGN KEY (adjudicator_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.adjudications
    ADD CONSTRAINT fk_adjudications_sent_by_user_id_users FOREIGN KEY (sent_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.adjudications
    ADD CONSTRAINT fk_adjudications_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id);
--
ALTER TABLE ONLY public.adjudications
    ADD CONSTRAINT fk_adjudications_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.annotation_versions
    ADD CONSTRAINT fk_annotation_versions_annotation_id_annotations FOREIGN KEY (annotation_id) REFERENCES public.annotations(id);
--
ALTER TABLE ONLY public.annotation_versions
    ADD CONSTRAINT fk_annotation_versions_changed_by_user_id_users FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT fk_annotations_class_id_project_id_project_classes FOREIGN KEY (class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT fk_annotations_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT fk_annotations_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT fk_annotations_slide_id_project_id_slides FOREIGN KEY (slide_id, project_id) REFERENCES public.slides(id, project_id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT fk_annotations_task_id_review_task_slides FOREIGN KEY (task_id, slide_id) REFERENCES public.review_task_slides(task_id, slide_id);
--
ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT fk_annotations_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT fk_announcements_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT fk_announcements_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT fk_api_tokens_service_account_id_service_accounts FOREIGN KEY (service_account_id) REFERENCES public.service_accounts(id);
--
ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT fk_api_tokens_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT fk_audit_events_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT fk_blocks_specimen_id_case_id_tenant_id_specimens FOREIGN KEY (specimen_id, case_id, tenant_id) REFERENCES public.specimens(id, case_id, tenant_id);
--
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT fk_blocks_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.case_requests
    ADD CONSTRAINT fk_case_requests_case_id_tenant_id_cases FOREIGN KEY (case_id, tenant_id) REFERENCES public.cases(id, tenant_id);
--
ALTER TABLE ONLY public.case_requests
    ADD CONSTRAINT fk_case_requests_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.case_requests
    ADD CONSTRAINT fk_case_requests_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT fk_cases_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT fk_cases_patient_id_project_id_patients FOREIGN KEY (patient_id, project_id) REFERENCES public.patients(id, project_id);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT fk_cases_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.cases
    ADD CONSTRAINT fk_cases_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.class_mappings
    ADD CONSTRAINT fk_class_mappings_class_id_project_id_project_classes FOREIGN KEY (class_id, project_id) REFERENCES public.project_classes(id, project_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.class_mappings
    ADD CONSTRAINT fk_class_mappings_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.clinical_deposits
    ADD CONSTRAINT fk_clinical_deposits_report_id_clinical_reports FOREIGN KEY (report_id) REFERENCES public.clinical_reports(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.clinical_deposits
    ADD CONSTRAINT fk_clinical_deposits_slide_id_slides FOREIGN KEY (slide_id) REFERENCES public.slides(id);
--
ALTER TABLE ONLY public.clinical_deposits
    ADD CONSTRAINT fk_clinical_deposits_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.clinical_report_versions
    ADD CONSTRAINT fk_clinical_report_versions_report_id_clinical_reports FOREIGN KEY (report_id) REFERENCES public.clinical_reports(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.clinical_report_versions
    ADD CONSTRAINT fk_clinical_report_versions_reported_by_user_id_users FOREIGN KEY (reported_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.clinical_report_versions
    ADD CONSTRAINT fk_clinical_report_versions_signed_by_user_id_users FOREIGN KEY (signed_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.clinical_report_versions
    ADD CONSTRAINT fk_clinical_report_versions_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT fk_clinical_reports_case_id_project_id_cases FOREIGN KEY (case_id, project_id) REFERENCES public.cases(id, project_id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT fk_clinical_reports_cosigner_user_id_users FOREIGN KEY (cosigner_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT fk_clinical_reports_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT fk_clinical_reports_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT fk_clinical_reports_sent_by_user_id_users FOREIGN KEY (sent_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.clinical_reports
    ADD CONSTRAINT fk_clinical_reports_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.disagreement_decisions
    ADD CONSTRAINT fk_disagreement_decisions_answer_class_id_project_classes FOREIGN KEY (answer_class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.disagreement_decisions
    ADD CONSTRAINT fk_disagreement_decisions_decided_by_user_id_users FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.disagreement_decisions
    ADD CONSTRAINT fk_disagreement_decisions_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.disagreement_decisions
    ADD CONSTRAINT fk_disagreement_decisions_task_id_slide_id_review_task_slides FOREIGN KEY (task_id, slide_id) REFERENCES public.review_task_slides(task_id, slide_id);
--
ALTER TABLE ONLY public.display_choices
    ADD CONSTRAINT fk_display_choices_preset_id_display_presets FOREIGN KEY (preset_id) REFERENCES public.display_presets(id) ON DELETE SET NULL;
--
ALTER TABLE ONLY public.display_choices
    ADD CONSTRAINT fk_display_choices_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id);
--
ALTER TABLE ONLY public.display_choices
    ADD CONSTRAINT fk_display_choices_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.display_presets
    ADD CONSTRAINT fk_display_presets_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id);
--
ALTER TABLE ONLY public.display_presets
    ADD CONSTRAINT fk_display_presets_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.display_presets
    ADD CONSTRAINT fk_display_presets_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.emergency_grants
    ADD CONSTRAINT fk_emergency_grants_project_id_privacy_mode_projects FOREIGN KEY (project_id, privacy_mode) REFERENCES public.projects(id, privacy_mode);
--
ALTER TABLE ONLY public.emergency_grants
    ADD CONSTRAINT fk_emergency_grants_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.emergency_grants
    ADD CONSTRAINT fk_emergency_grants_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id);
--
ALTER TABLE ONLY public.evaluation_changes
    ADD CONSTRAINT fk_evaluation_changes_changed_by_user_id_users FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.evaluation_changes
    ADD CONSTRAINT fk_evaluation_changes_slide_id_slides FOREIGN KEY (slide_id) REFERENCES public.slides(id);
--
ALTER TABLE ONLY public.evaluation_changes
    ADD CONSTRAINT fk_evaluation_changes_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.evaluation_changes
    ADD CONSTRAINT fk_evaluation_changes_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.evaluation_versions
    ADD CONSTRAINT fk_evaluation_versions_signed_by_user_id_users FOREIGN KEY (signed_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.evaluation_versions
    ADD CONSTRAINT fk_evaluation_versions_started_by_user_id_users FOREIGN KEY (started_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.evaluation_versions
    ADD CONSTRAINT fk_evaluation_versions_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.evaluation_versions
    ADD CONSTRAINT fk_evaluation_versions_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.gpu_usage
    ADD CONSTRAINT fk_gpu_usage_job_id_jobs FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.hidden_models
    ADD CONSTRAINT fk_hidden_models_hidden_by_user_id_users FOREIGN KEY (hidden_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.hidden_models
    ADD CONSTRAINT fk_hidden_models_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT fk_invitations_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id);
--
ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT fk_invitations_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.job_steps
    ADD CONSTRAINT fk_job_steps_job_id_jobs FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.job_units
    ADD CONSTRAINT fk_job_units_job_id_ordinal_job_steps FOREIGN KEY (job_id, ordinal) REFERENCES public.job_steps(job_id, ordinal) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT fk_jobs_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT fk_jobs_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.lab_model_projects
    ADD CONSTRAINT fk_lab_model_projects_lab_model_id_lab_models FOREIGN KEY (lab_model_id) REFERENCES public.lab_models(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.lab_model_projects
    ADD CONSTRAINT fk_lab_model_projects_project_id_projects FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.lab_model_projects
    ADD CONSTRAINT fk_lab_model_projects_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.lab_models
    ADD CONSTRAINT fk_lab_models_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.lab_models
    ADD CONSTRAINT fk_lab_models_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT fk_legal_holds_placed_by_user_id_users FOREIGN KEY (placed_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT fk_legal_holds_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT fk_legal_holds_released_by_user_id_users FOREIGN KEY (released_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.legal_holds
    ADD CONSTRAINT fk_legal_holds_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT fk_memberships_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT fk_memberships_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.model_runs
    ADD CONSTRAINT fk_model_runs_job_id_jobs FOREIGN KEY (job_id) REFERENCES public.jobs(id);
--
ALTER TABLE ONLY public.model_runs
    ADD CONSTRAINT fk_model_runs_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.model_runs
    ADD CONSTRAINT fk_model_runs_slide_id_project_id_slides FOREIGN KEY (slide_id, project_id) REFERENCES public.slides(id, project_id);
--
ALTER TABLE ONLY public.model_runs
    ADD CONSTRAINT fk_model_runs_started_by_user_id_users FOREIGN KEY (started_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.model_runs
    ADD CONSTRAINT fk_model_runs_task_id_project_id_review_tasks FOREIGN KEY (task_id, project_id) REFERENCES public.review_tasks(id, project_id);
--
ALTER TABLE ONLY public.model_tiers
    ADD CONSTRAINT fk_model_tiers_set_by_user_id_users FOREIGN KEY (set_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.model_tiers
    ADD CONSTRAINT fk_model_tiers_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.notification_mutes
    ADD CONSTRAINT fk_notification_mutes_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT fk_notification_preferences_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.opinion_forms
    ADD CONSTRAINT fk_opinion_forms_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.opinion_forms
    ADD CONSTRAINT fk_opinion_forms_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.opinion_forms
    ADD CONSTRAINT fk_opinion_forms_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.opinions
    ADD CONSTRAINT fk_opinions_project_id_form_version_opinion_forms FOREIGN KEY (project_id, form_version) REFERENCES public.opinion_forms(project_id, version);
--
ALTER TABLE ONLY public.opinions
    ADD CONSTRAINT fk_opinions_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.opinions
    ADD CONSTRAINT fk_opinions_task_id_slide_id_user_id_review_assignments FOREIGN KEY (task_id, slide_id, user_id) REFERENCES public.review_assignments(task_id, slide_id, user_id);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT fk_patients_project_id_privacy_mode_projects FOREIGN KEY (project_id, privacy_mode) REFERENCES public.projects(id, privacy_mode);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT fk_patients_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.patients
    ADD CONSTRAINT fk_patients_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.personal_settings
    ADD CONSTRAINT fk_personal_settings_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.project_classes
    ADD CONSTRAINT fk_project_classes_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.project_classes
    ADD CONSTRAINT fk_project_classes_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT fk_project_members_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT fk_project_members_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT fk_projects_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT fk_projects_study_template_id_study_templates FOREIGN KEY (study_template_id) REFERENCES public.study_templates(id);
--
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT fk_projects_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.registered_models
    ADD CONSTRAINT fk_registered_models_part_of FOREIGN KEY (part_of_name, part_of_version) REFERENCES public.registered_models(name, version);
--
ALTER TABLE ONLY public.report_links
    ADD CONSTRAINT fk_report_links_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.report_links
    ADD CONSTRAINT fk_report_links_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.report_links
    ADD CONSTRAINT fk_report_links_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.result_chunks
    ADD CONSTRAINT fk_result_chunks_result_set_id_result_sets FOREIGN KEY (result_set_id) REFERENCES public.result_sets(id);
--
ALTER TABLE ONLY public.result_objects
    ADD CONSTRAINT fk_result_objects_result_set_id_result_sets FOREIGN KEY (result_set_id) REFERENCES public.result_sets(id);
--
ALTER TABLE ONLY public.result_set_classes
    ADD CONSTRAINT fk_result_set_classes_class_id_project_id_project_classes FOREIGN KEY (class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.result_set_classes
    ADD CONSTRAINT fk_result_set_classes_result_set_id_project_id_result_sets FOREIGN KEY (result_set_id, project_id) REFERENCES public.result_sets(id, project_id);
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT fk_result_sets_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT fk_result_sets_job_id_jobs FOREIGN KEY (job_id) REFERENCES public.jobs(id);
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT fk_result_sets_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT fk_result_sets_slide_id_project_id_slides FOREIGN KEY (slide_id, project_id) REFERENCES public.slides(id, project_id);
--
ALTER TABLE ONLY public.result_sets
    ADD CONSTRAINT fk_result_sets_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.resume_states
    ADD CONSTRAINT fk_resume_states_slide_id_slides FOREIGN KEY (slide_id) REFERENCES public.slides(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.resume_states
    ADD CONSTRAINT fk_resume_states_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.resume_states
    ADD CONSTRAINT fk_resume_states_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT fk_retention_policies_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.review_assignments
    ADD CONSTRAINT fk_review_assignments_task_id_slide_id_review_task_slides FOREIGN KEY (task_id, slide_id) REFERENCES public.review_task_slides(task_id, slide_id);
--
ALTER TABLE ONLY public.review_assignments
    ADD CONSTRAINT fk_review_assignments_tenant_id_user_id_memberships FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id);
--
ALTER TABLE ONLY public.review_decisions
    ADD CONSTRAINT fk_review_decisions_ai_class_id_project_id_project_classes FOREIGN KEY (ai_class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.review_decisions
    ADD CONSTRAINT fk_review_decisions_answer_class_id_project_id_project_classes FOREIGN KEY (answer_class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.review_decisions
    ADD CONSTRAINT fk_review_decisions_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.review_decisions
    ADD CONSTRAINT fk_review_decisions_reason_class_id_project_id_project_classes FOREIGN KEY (reason_class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.review_decisions
    ADD CONSTRAINT fk_review_decisions_task_id_slide_id_user_id_review_assignments FOREIGN KEY (task_id, slide_id, user_id) REFERENCES public.review_assignments(task_id, slide_id, user_id);
--
ALTER TABLE ONLY public.review_edits
    ADD CONSTRAINT fk_review_edits_class_id_project_id_project_classes FOREIGN KEY (class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.review_edits
    ADD CONSTRAINT fk_review_edits_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.review_edits
    ADD CONSTRAINT fk_review_edits_task_id_slide_id_user_id_review_assignments FOREIGN KEY (task_id, slide_id, user_id) REFERENCES public.review_assignments(task_id, slide_id, user_id);
--
ALTER TABLE ONLY public.review_order
    ADD CONSTRAINT fk_review_order_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.review_order
    ADD CONSTRAINT fk_review_order_task_id_slide_id_review_task_slides FOREIGN KEY (task_id, slide_id) REFERENCES public.review_task_slides(task_id, slide_id);
--
ALTER TABLE ONLY public.review_skips
    ADD CONSTRAINT fk_review_skips_ai_class_id_project_id_project_classes FOREIGN KEY (ai_class_id, project_id) REFERENCES public.project_classes(id, project_id);
--
ALTER TABLE ONLY public.review_skips
    ADD CONSTRAINT fk_review_skips_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.review_skips
    ADD CONSTRAINT fk_review_skips_task_id_slide_id_user_id_review_assignments FOREIGN KEY (task_id, slide_id, user_id) REFERENCES public.review_assignments(task_id, slide_id, user_id);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT fk_review_task_slides_result_set_id_project_id_result_sets FOREIGN KEY (result_set_id, project_id) REFERENCES public.result_sets(id, project_id);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT fk_review_task_slides_signed_off_by_user_id_users FOREIGN KEY (signed_off_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT fk_review_task_slides_slide_id_project_id_slides FOREIGN KEY (slide_id, project_id) REFERENCES public.slides(id, project_id);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT fk_review_task_slides_task_id_kind_review_tasks FOREIGN KEY (task_id, kind) REFERENCES public.review_tasks(id, kind);
--
ALTER TABLE ONLY public.review_task_slides
    ADD CONSTRAINT fk_review_task_slides_task_id_project_id_review_tasks FOREIGN KEY (task_id, project_id) REFERENCES public.review_tasks(id, project_id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT fk_review_tasks_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT fk_review_tasks_project_id_opinion_form_version_opinion_forms FOREIGN KEY (project_id, opinion_form_version) REFERENCES public.opinion_forms(project_id, version);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT fk_review_tasks_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT fk_review_tasks_signed_off_by_user_id_users FOREIGN KEY (signed_off_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT fk_review_tasks_study_template_versions FOREIGN KEY (study_template_id, study_template_version, tenant_id) REFERENCES public.study_template_versions(template_id, version, tenant_id);
--
ALTER TABLE ONLY public.review_tasks
    ADD CONSTRAINT fk_review_tasks_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT fk_service_accounts_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.session_policies
    ADD CONSTRAINT fk_session_policies_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_sessions_active_tenant_id_tenants FOREIGN KEY (active_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
--
ALTER TABLE ONLY public.site_validations
    ADD CONSTRAINT fk_site_validations_announcement_id_announcements FOREIGN KEY (announcement_id) REFERENCES public.announcements(id);
--
ALTER TABLE ONLY public.site_validations
    ADD CONSTRAINT fk_site_validations_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.site_validations
    ADD CONSTRAINT fk_site_validations_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.slide_counters
    ADD CONSTRAINT fk_slide_counters_slide_id_slides FOREIGN KEY (slide_id) REFERENCES public.slides(id);
--
ALTER TABLE ONLY public.slide_coverage
    ADD CONSTRAINT fk_slide_coverage_slide_id_slides FOREIGN KEY (slide_id) REFERENCES public.slides(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.slide_coverage
    ADD CONSTRAINT fk_slide_coverage_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT fk_slides_block_id_case_id_blocks FOREIGN KEY (block_id, case_id) REFERENCES public.blocks(id, case_id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT fk_slides_case_id_project_id_cases FOREIGN KEY (case_id, project_id) REFERENCES public.cases(id, project_id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT fk_slides_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT fk_slides_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.slides
    ADD CONSTRAINT fk_slides_upload_id_project_id_uploads FOREIGN KEY (upload_id, project_id) REFERENCES public.uploads(id, project_id);
--
ALTER TABLE ONLY public.specimens
    ADD CONSTRAINT fk_specimens_case_id_tenant_id_cases FOREIGN KEY (case_id, tenant_id) REFERENCES public.cases(id, tenant_id);
--
ALTER TABLE ONLY public.specimens
    ADD CONSTRAINT fk_specimens_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.stage_throughput
    ADD CONSTRAINT fk_stage_throughput_job_id_ordinal_job_steps FOREIGN KEY (job_id, ordinal) REFERENCES public.job_steps(job_id, ordinal) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.study_template_versions
    ADD CONSTRAINT fk_study_template_versions_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.study_template_versions
    ADD CONSTRAINT fk_study_template_versions_study_templates FOREIGN KEY (template_id, tenant_id) REFERENCES public.study_templates(id, tenant_id);
--
ALTER TABLE ONLY public.study_template_versions
    ADD CONSTRAINT fk_study_template_versions_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.study_templates
    ADD CONSTRAINT fk_study_templates_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.study_templates
    ADD CONSTRAINT fk_study_templates_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.task_nudges
    ADD CONSTRAINT fk_task_nudges_sent_by_user_id_users FOREIGN KEY (sent_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.task_nudges
    ADD CONSTRAINT fk_task_nudges_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id);
--
ALTER TABLE ONLY public.task_nudges
    ADD CONSTRAINT fk_task_nudges_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.task_nudges
    ADD CONSTRAINT fk_task_nudges_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.task_reassignments
    ADD CONSTRAINT fk_task_reassignments_from_user_id_users FOREIGN KEY (from_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.task_reassignments
    ADD CONSTRAINT fk_task_reassignments_task_id_review_tasks FOREIGN KEY (task_id) REFERENCES public.review_tasks(id);
--
ALTER TABLE ONLY public.task_reassignments
    ADD CONSTRAINT fk_task_reassignments_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.task_reassignments
    ADD CONSTRAINT fk_task_reassignments_to_user_id_users FOREIGN KEY (to_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.template_offers
    ADD CONSTRAINT fk_template_offers_decided_by_user_id_users FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.template_offers
    ADD CONSTRAINT fk_template_offers_offered_by_user_id_users FOREIGN KEY (offered_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.template_offers
    ADD CONSTRAINT fk_template_offers_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.tenant_keys
    ADD CONSTRAINT fk_tenant_keys_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT fk_tenants_organisation_id_organisations FOREIGN KEY (organisation_id) REFERENCES public.organisations(id);
--
ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT fk_thread_messages_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT fk_thread_messages_thread_id_threads FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;
--
ALTER TABLE ONLY public.thread_messages
    ADD CONSTRAINT fk_thread_messages_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT fk_threads_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT fk_threads_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT fk_threads_resolved_by_user_id_users FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT fk_threads_result_set_id_result_sets FOREIGN KEY (result_set_id) REFERENCES public.result_sets(id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT fk_threads_task_id_slide_id_review_task_slides FOREIGN KEY (task_id, slide_id) REFERENCES public.review_task_slides(task_id, slide_id);
--
ALTER TABLE ONLY public.threads
    ADD CONSTRAINT fk_threads_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_case_id_project_id_cases FOREIGN KEY (case_id, project_id) REFERENCES public.cases(id, project_id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_created_by_service_id_service_accounts FOREIGN KEY (created_by_service_id) REFERENCES public.service_accounts(id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_created_by_user_id_users FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_job_id_jobs FOREIGN KEY (job_id) REFERENCES public.jobs(id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_project_id_tenant_id_projects FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_result_set_id_project_id_result_sets FOREIGN KEY (result_set_id, project_id) REFERENCES public.result_sets(id, project_id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_slide_id_project_id_slides FOREIGN KEY (slide_id, project_id) REFERENCES public.slides(id, project_id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_slide_upload_id_project_id_uploads FOREIGN KEY (slide_upload_id, project_id) REFERENCES public.uploads(id, project_id);
--
ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT fk_uploads_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_last_tenant_id_tenants FOREIGN KEY (last_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
--
ALTER TABLE ONLY public.workspace_access_requests
    ADD CONSTRAINT fk_workspace_access_requests_decided_by_user_id_users FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.workspace_access_requests
    ADD CONSTRAINT fk_workspace_access_requests_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
--
ALTER TABLE ONLY public.workspace_access_requests
    ADD CONSTRAINT fk_workspace_access_requests_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id);
--
ALTER TABLE ONLY public.workspace_settings
    ADD CONSTRAINT fk_workspace_settings_tenant_id_tenants FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
--
ALTER TABLE public.adjudication_objects ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.adjudications ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.annotation_versions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.audit_people ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY auth_audit ON public.audit_events USING (((tenant_id IS NULL) AND (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text))) WITH CHECK (((tenant_id IS NULL) AND (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)));
--
ALTER TABLE public.auth_logins ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY auth_only ON public.auth_logins USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_only ON public.platform_operators USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_only ON public.rate_counters USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_only ON public.sessions USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_read ON public.api_tokens FOR SELECT USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_read ON public.invitations FOR SELECT USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_read ON public.report_links FOR SELECT USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_read ON public.service_accounts FOR SELECT USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_read ON public.session_policies FOR SELECT USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY auth_touch ON public.api_tokens FOR UPDATE USING ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text));
--
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.case_requests ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.class_mappings ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.clinical_deposits ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.clinical_report_versions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.clinical_reports ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.disagreement_decisions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.display_choices ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.display_presets ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.emergency_grants ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.evaluation_changes ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.evaluation_versions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.gpu_usage ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.hidden_models ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.job_steps ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.job_units ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY known_people ON public.audit_people FOR SELECT USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text) OR ((subject)::text IN ( SELECT users.subject
   FROM public.users))));
--
ALTER TABLE public.lab_model_projects ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.lab_models ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.model_runs ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.model_tiers ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY new_people ON public.audit_people FOR INSERT WITH CHECK (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text) OR ((subject)::text IN ( SELECT users.subject
   FROM public.users))));
--
ALTER TABLE public.notification_mutes ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.opinion_forms ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.opinions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY own_memberships ON public.memberships FOR SELECT USING ((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid));
--
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.personal_settings ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY platform_audit ON public.audit_events USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_changes_keys ON public.tenant_keys AS RESTRICTIVE FOR UPDATE USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_claims ON public.jobs USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_forgets ON public.audit_people FOR DELETE USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_keys ON public.tenant_keys USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
ALTER TABLE public.platform_operators ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY platform_read ON public.organisations FOR SELECT USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (id IN ( SELECT tenants.organisation_id
   FROM public.tenants))));
--
CREATE POLICY platform_read ON public.registered_models FOR SELECT USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR true));
--
CREATE POLICY platform_read ON public.tenants FOR SELECT USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) OR (id IN ( SELECT memberships.tenant_id
   FROM public.memberships
  WHERE (memberships.user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))));
--
CREATE POLICY platform_seed ON public.study_template_versions FOR INSERT WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_seed ON public.study_templates FOR INSERT WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_shreds_keys ON public.tenant_keys AS RESTRICTIVE FOR DELETE USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_write ON public.invitations USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_write ON public.memberships USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_write ON public.organisations USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_write ON public.registered_models USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
CREATE POLICY platform_write ON public.tenants USING ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text)) WITH CHECK ((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text));
--
ALTER TABLE public.project_classes ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.rate_counters ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.registered_models ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.report_links ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.result_chunks ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.result_objects ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.result_set_classes ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.result_sets ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.resume_states ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_assignments ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_decisions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_edits ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_order ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_skips ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_task_slides ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.review_tasks ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.service_accounts ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY service_read ON public.memberships FOR SELECT USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)));
--
ALTER TABLE public.session_policies ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.site_validations ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.slide_counters ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.slide_coverage ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.slides ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.specimens ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.stage_throughput ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.study_template_versions ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.study_templates ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.task_nudges ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.task_reassignments ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.template_offers ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY tenant_isolation ON public.adjudication_objects USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.adjudications USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.annotation_versions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.annotations USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.announcements USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.api_tokens USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.audit_events USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.blocks USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.case_requests USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.cases USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.class_mappings USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.clinical_deposits USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.clinical_report_versions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.clinical_reports USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.disagreement_decisions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.display_choices USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.display_presets USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.emergency_grants USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.evaluation_changes USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.evaluation_versions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.gpu_usage USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.hidden_models USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.invitations USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.job_steps USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.job_units USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.jobs USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.lab_model_projects USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.lab_models USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.legal_holds USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.memberships USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.model_runs USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.model_tiers USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.notification_mutes USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.notification_preferences USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.notifications USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.opinion_forms USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.opinions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.patients USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.personal_settings USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.project_classes USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.project_members USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.projects USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.report_links USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.result_chunks USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.result_objects USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.result_set_classes USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.result_sets USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.resume_states USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.retention_policies USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_assignments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_decisions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_edits USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_order USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_skips USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_task_slides USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.review_tasks USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.service_accounts USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.session_policies USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.site_validations USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.slide_counters USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.slide_coverage USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.slides USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.specimens USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.stage_throughput USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.study_template_versions USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.study_templates USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.task_nudges USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.task_reassignments USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.template_offers USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.tenant_keys USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.thread_messages USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.threads USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.uploads USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.workspace_access_requests USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
CREATE POLICY tenant_isolation ON public.workspace_settings USING ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid));
--
ALTER TABLE public.tenant_keys ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.thread_messages ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--
CREATE POLICY users_asking ON public.users FOR SELECT USING ((id IN ( SELECT workspace_access_requests.user_id
   FROM public.workspace_access_requests
  WHERE ((workspace_access_requests.tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND ((workspace_access_requests.status)::text = 'pending'::text)))));
--
CREATE POLICY users_read ON public.users FOR SELECT USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text) OR (id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (id IN ( SELECT memberships.user_id
   FROM public.memberships
  WHERE (memberships.tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)))));
--
CREATE POLICY users_self ON public.users FOR UPDATE USING ((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid));
--
CREATE POLICY users_write ON public.users USING (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text))) WITH CHECK (((COALESCE(current_setting('app.platform'::text, true), ''::text) = 'on'::text) OR (COALESCE(current_setting('app.auth'::text, true), ''::text) = 'on'::text)));
--
ALTER TABLE public.workspace_access_requests ENABLE ROW LEVEL SECURITY;
--
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
--
GRANT USAGE ON SCHEMA public TO parfocal_app;
--
REVOKE ALL ON FUNCTION public.parfocal_retention_purge() FROM PUBLIC;
--
GRANT ALL ON FUNCTION public.parfocal_retention_purge() TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.adjudication_objects TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.adjudications TO parfocal_app;
--
GRANT SELECT,INSERT ON TABLE public.annotation_versions TO parfocal_app;
--
GRANT SELECT,INSERT,UPDATE ON TABLE public.annotations TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.announcements TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE ON TABLE public.api_tokens TO parfocal_app;
--
GRANT UPDATE(revoked_at) ON TABLE public.api_tokens TO parfocal_app;
--
GRANT UPDATE(last_used_at) ON TABLE public.api_tokens TO parfocal_app;
--
GRANT SELECT,INSERT ON TABLE public.audit_events TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE ON TABLE public.audit_people TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_logins TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blocks TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.case_requests TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cases TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.class_mappings TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.clinical_deposits TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.clinical_report_versions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.clinical_reports TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.disagreement_decisions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.display_choices TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.display_presets TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.emergency_grants TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.evaluation_changes TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.evaluation_versions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE ON TABLE public.gpu_usage TO parfocal_app;
--
GRANT SELECT,USAGE ON SEQUENCE public.gpu_usage_id_seq TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hidden_models TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitations TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_steps TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_units TO parfocal_app;
--
GRANT SELECT,USAGE ON SEQUENCE public.job_units_seq_seq TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.jobs TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.lab_model_projects TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.lab_models TO parfocal_app;
--
GRANT SELECT,INSERT,UPDATE ON TABLE public.legal_holds TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.memberships TO parfocal_app;
--
GRANT SELECT,INSERT ON TABLE public.model_runs TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.model_tiers TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_mutes TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_preferences TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opinion_forms TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opinions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organisations TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.patients TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.personal_settings TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_operators TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_classes TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_members TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.projects TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rate_counters TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.registered_models TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.report_links TO parfocal_app;
--
GRANT SELECT,INSERT ON TABLE public.result_chunks TO parfocal_app;
--
GRANT SELECT,INSERT ON TABLE public.result_objects TO parfocal_app;
--
GRANT SELECT,INSERT,UPDATE ON TABLE public.result_set_classes TO parfocal_app;
--
GRANT SELECT,INSERT,UPDATE ON TABLE public.result_sets TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.resume_states TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.retention_policies TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_assignments TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_decisions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_edits TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_order TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_skips TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_task_slides TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_tasks TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_accounts TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.session_policies TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.site_validations TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.slide_counters TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.slide_coverage TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.slides TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.specimens TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stage_throughput TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.study_template_versions TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.study_templates TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_nudges TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_reassignments TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.template_offers TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_keys TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenants TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.thread_messages TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.threads TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.uploads TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_access_requests TO parfocal_app;
--
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_settings TO parfocal_app;
--
SELECT set_config('app.platform', 'on', true);
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "camelyon-tumor", "makes": ["regions", "heatmap"], "tasks": ["tumor-map"], "title": "CAMELYON tumor model", "family": "monai-pathology-tumor-detection", "status": "candidate", "version": "v1.0", "input_mpp": null, "evaluation": null, "licence_code": "Apache-2.0", "licence_data": [{"dataset": "CAMELYON16", "licence": "Two primary pages disagree, CC0 and CC BY-NC-ND 4.0", "licence_class": "unconfirmed"}, {"dataset": "ImageNet start weights", "licence": "For non-commercial use", "licence_class": "restricted"}], "part_of_name": null, "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-10-14", "licence_weights": "MONAI bundle Apache-2.0, from ImageNet weights for non-commercial use", "part_of_version": null, "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "hovernet", "makes": ["cells"], "tasks": ["detector", "typer"], "title": "HoVer-Net", "family": "monai-pathology-nuclei-segmentation-classification", "status": "retired", "version": "v0.9", "input_mpp": null, "evaluation": null, "licence_code": "Apache-2.0", "licence_data": [{"dataset": "CoNSeP", "licence": "TODO", "licence_class": "unconfirmed"}], "part_of_name": null, "licence_source": "docs/adr/0042-model-licensing-policy.md", "licence_read_on": "2026-10-14", "licence_weights": "MONAI bundle Apache-2.0, original HoVer-Net weights for non-commercial use", "part_of_version": null, "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-hovernext", "makes": ["regions", "cells"], "tasks": ["detector", "typer"], "title": "PathoSAM + HoVer-NeXt", "family": "pathosam-hovernext", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT, HoVer-NeXt GPL-3.0 and no code copied", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": null, "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. HoVer-NeXt CC BY-NC-SA 4.0", "part_of_version": null, "evaluation_report": "docs/results/2026-11-04-typer-calibration-registry.md", "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {"1": 1.42, "8": 1.29}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "hovernext-pannuke", "makes": ["cells"], "tasks": ["typer"], "title": "HoVer-NeXt typer, PanNuke weights", "family": "hovernext", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "HoVer-NeXt GPL-3.0 and no code copied", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "HoVer-NeXt PanNuke weights CC BY-NC-SA 4.0, Zenodo 10635618, not re-read", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-vit-b-ais-decoder", "makes": ["cells"], "tasks": ["decoder", "detector"], "title": "PathoSAM ViT-B AIS decoder", "family": "pathosam", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. Non-commercial in practice", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-vit-b-encoder", "makes": [], "tasks": ["interactive-encoder"], "title": "PathoSAM ViT-B encoder", "family": "pathosam", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. Non-commercial in practice", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-vit-b-prompt-decoder", "makes": ["regions"], "tasks": ["decoder"], "title": "PathoSAM ViT-B click and box decoder", "family": "pathosam", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. Non-commercial in practice", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-vit-l-ais-decoder", "makes": ["cells"], "tasks": ["decoder", "detector"], "title": "PathoSAM ViT-L AIS decoder", "family": "pathosam", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. Non-commercial in practice", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-vit-l-encoder", "makes": [], "tasks": ["interactive-encoder"], "title": "PathoSAM ViT-L encoder", "family": "pathosam", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. Non-commercial in practice", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
--
INSERT INTO public.registered_models (name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation)
SELECT name, version, family, title, tasks, makes, host, licence_weights, licence_weights_class, licence_code, licence_data, licence_source, licence_read_on, allowed_tenant_kinds, input_mpp, status, evaluation_report, calibration_temperatures, part_of_name, part_of_version, evaluation FROM jsonb_populate_record(NULL::public.registered_models, '{"host": "parfocal", "name": "pathosam-vit-l-prompt-decoder", "makes": ["regions"], "tasks": ["decoder"], "title": "PathoSAM ViT-L click and box decoder", "family": "pathosam", "status": "candidate", "version": "v1.2", "input_mpp": 0.25, "evaluation": null, "licence_code": "PathoSAM MIT", "licence_data": [{"dataset": "PanNuke", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "Lizard", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}, {"dataset": "MoNuSeg", "licence": "CC BY-NC-SA 4.0", "licence_class": "restricted"}], "part_of_name": "pathosam-hovernext", "licence_source": "docs/adr/0202-v1-model-line-up-per-tier.md", "licence_read_on": "2026-11-03", "licence_weights": "PathoSAM TODO, not stated on the repository. Non-commercial in practice", "part_of_version": "v1.2", "evaluation_report": null, "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"], "licence_weights_class": "restricted", "calibration_temperatures": {}}');
