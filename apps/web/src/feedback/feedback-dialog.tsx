import { useSendFeedback } from "@parfocal/api-client";
import { CheckboxField, FormField, TextAreaInput } from "@parfocal/ui/components/form-field";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useState } from "react";
import { closeFeedback, type FeedbackState } from "./feedback-state.ts";

const maxLength = 4000;
const pngPrefix = "data:image/png;base64,";

type Writing = Extract<FeedbackState, { step: "writing" }>;

export default function FeedbackDialog({ feedback }: { feedback: Writing }) {
  const send = useSendFeedback();
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(feedback.screenshot !== null);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [sent, setSent] = useState(false);
  const trimmed = text.trim();
  const problem =
    trimmed === ""
      ? "Write what happened or what you would like"
      : trimmed.length > maxLength
        ? `Keep it under ${maxLength} characters`
        : undefined;
  const screenshot = attach && feedback.screenshot ? feedback.screenshot : null;
  return (
    <SmallModal
      open
      onOpenChange={(next) => {
        if (!next) closeFeedback();
      }}
      title={sent ? "Thanks, the team has it" : "Send feedback"}
      subtitle={
        sent
          ? "We read every message. Nothing else from this screen was sent."
          : "Goes to the Parfocal team. Slides, images, names and case details are blurred in your browser before anything is sent."
      }
      width={560}
      primaryLabel={sent ? "Done" : "Send"}
      showCancel={!sent}
      primaryBusy={send.isPending}
      blockers={
        tried && problem
          ? [{ id: "text", text: problem, goTo: "Go to the text" }]
          : failure
            ? [{ id: "failure", text: failure, goTo: "Try again" }]
            : []
      }
      blockersTitle="Before you can send"
      onPrimary={() => {
        if (sent) {
          closeFeedback();
          return;
        }
        setTried(true);
        setFailure(undefined);
        if (problem) return;
        send.mutate(
          {
            data: {
              text: trimmed,
              path: feedback.path,
              viewport: feedback.viewport,
              screenshot_png: screenshot ? screenshot.slice(pngPrefix.length) : null,
            },
          },
          {
            onSuccess: (response) => {
              if (response.status !== 200) {
                setFailure("The team did not get it. Try again in a moment.");
                return;
              }
              setSent(true);
            },
            onError: () => setFailure("The team did not get it. Try again in a moment."),
          },
        );
      }}
    >
      {sent ? null : (
        <>
          <FormField
            label="What happened, or what would help?"
            error={tried ? problem : undefined}
            count={`${trimmed.length} of ${maxLength}`}
          >
            <TextAreaInput
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Leave out patient names and case numbers."
            />
          </FormField>
          {feedback.screenshot ? (
            <>
              <CheckboxField
                label="Attach the blurred screenshot"
                checked={attach}
                onCheckedChange={(next) => setAttach(next === true)}
              />
              {attach ? (
                <img
                  src={feedback.screenshot}
                  alt="The screenshot that will be sent, with slides and patient details blurred"
                  data-testid="feedback-screenshot"
                  className="max-h-56 w-full rounded-sm border border-line object-contain"
                />
              ) : null}
            </>
          ) : (
            <p className="text-body-sm text-fg-dim">
              This browser could not take a screenshot, so only your text is sent.
            </p>
          )}
        </>
      )}
    </SmallModal>
  );
}
