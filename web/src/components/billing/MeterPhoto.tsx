import { useEffect, useRef, useState } from "react";
import { Button, Modal, Popconfirm, Space, Spin, Tooltip, Typography, message } from "antd";
import { CameraOutlined, CloseCircleFilled, PictureOutlined, WarningOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { shrinkPhoto } from "../../api/image";

/** Picks a photo of the meter (camera or library) and shrinks it; the caller uploads it with the reading. */
export function PhotoPicker({ value, onChange }: { value: File | null; onChange: (file: File | null) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return setPreview(null);
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await shrinkPhoto(file));
    } catch {
      message.error(t("contracts.photoUnreadable"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Space align="center">
      <input ref={input} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void pick(e.target.files?.[0])} />
      <Button icon={<CameraOutlined />} loading={busy} onClick={() => input.current?.click()}>
        {value ? t("contracts.photoChange") : t("contracts.photoAdd")}
      </Button>
      {preview && (
        <span style={{ position: "relative", display: "inline-block" }}>
          <img src={preview} alt="" style={{ height: 48, borderRadius: 4, display: "block" }} />
          <CloseCircleFilled onClick={() => onChange(null)} style={{ position: "absolute", top: -6, right: -6, color: "#999", background: "#fff", borderRadius: "50%", cursor: "pointer" }} />
        </span>
      )}
    </Space>
  );
}

/** Uploads a (already shrunk) photo for a reading. */
export async function uploadMeterPhoto(entryId: number, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await api.post(`/usage-entries/${entryId}/photo`, form);
}

/** The photo column of the readings list: look at it, replace it, or remove it. */
export function MeterPhotoCell({
  entryId,
  documentId,
  missing,
  canEdit,
  onChanged,
}: {
  entryId: number;
  documentId: number | null;
  missing: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!viewing || !documentId || missing) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void fetch(`/api/documents/${documentId}/download`, { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          message.error(t("contracts.photoCantOpen"));
          setViewing(false);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [viewing, documentId, missing, t]);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadMeterPhoto(entryId, await shrinkPhoto(file));
      onChanged();
    } catch (err) {
      message.error(err instanceof Error && !("code" in err) ? t("contracts.photoUnreadable") : apiErrorMessage(err, t));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/usage-entries/${entryId}/photo`);
      setViewing(false);
      onChanged();
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    }
  };

  return (
    <>
      <input ref={input} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void attach(e.target.files?.[0])} />
      {documentId ? (
        <Tooltip title={missing ? t("contracts.photoMissing") : t("contracts.photoView")}>
          <Button size="small" danger={missing} icon={missing ? <WarningOutlined /> : <PictureOutlined />} onClick={() => setViewing(true)} />
        </Tooltip>
      ) : canEdit ? (
        <Tooltip title={t("contracts.photoAdd")}>
          <Button size="small" loading={busy} icon={<CameraOutlined />} onClick={() => input.current?.click()} />
        </Tooltip>
      ) : null}
      <Modal
        open={viewing}
        footer={
          canEdit && documentId ? (
            <Space>
              <Button loading={busy} icon={<CameraOutlined />} onClick={() => input.current?.click()}>
                {t("contracts.photoReplace")}
              </Button>
              <Popconfirm title={t("contracts.photoRemoveConfirm")} onConfirm={() => void remove()} okText={t("common.delete")} cancelText={t("common.cancel")}>
                <Button danger>{t("contracts.photoRemove")}</Button>
              </Popconfirm>
            </Space>
          ) : null
        }
        onCancel={() => setViewing(false)}
        width={720}
        style={{ top: 24, maxWidth: "calc(100vw - 16px)" }}
        destroyOnClose
      >
        {url ? <img src={url} alt="" style={{ width: "100%", borderRadius: 4 }} /> : missing ? <Typography.Text type="danger">{t("contracts.photoMissing")}</Typography.Text> : <Spin />}
      </Modal>
    </>
  );
}
