import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttachmentPreview, AttachButton, type ChatAttachment } from "@/components/chat/file-attachments";

describe("AttachmentPreview", () => {
  it("renders nothing when no attachments", () => {
    const { container } = render(
      <AttachmentPreview attachments={[]} onRemove={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders file attachment with name and size", () => {
    const att: ChatAttachment = {
      id: "1",
      file: new File(["hello"], "test.txt", { type: "text/plain" }),
      type: "file",
    };
    render(<AttachmentPreview attachments={[att]} onRemove={() => {}} />);
    expect(screen.getByText("test.txt")).toBeInTheDocument();
    expect(screen.getByText("5B")).toBeInTheDocument();
  });

  it("renders image attachment with thumbnail", () => {
    const att: ChatAttachment = {
      id: "1",
      file: new File([""], "photo.png", { type: "image/png" }),
      type: "image",
      preview: "data:image/png;base64,abc",
    };
    render(<AttachmentPreview attachments={[att]} onRemove={() => {}} />);
    expect(screen.getByRole("img", { name: "photo.png" })).toBeInTheDocument();
  });

  it("calls onRemove when remove button clicked", () => {
    const onRemove = vi.fn();
    const att: ChatAttachment = {
      id: "att-1",
      file: new File(["x"], "doc.pdf"),
      type: "file",
    };
    const { container } = render(
      <AttachmentPreview attachments={[att]} onRemove={onRemove} />
    );
    // Find the remove button (hidden by default, visible on group-hover)
    const removeBtn = container.querySelector("button");
    expect(removeBtn).not.toBeNull();
    if (removeBtn) {
      fireEvent.click(removeBtn);
      expect(onRemove).toHaveBeenCalledWith("att-1");
    }
  });
});

describe("AttachButton", () => {
  it("renders the attach button", () => {
    render(<AttachButton onAttach={() => {}} />);
    expect(screen.getByTitle("파일 첨부")).toBeInTheDocument();
  });
});
