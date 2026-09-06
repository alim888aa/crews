import { useState } from 'react'
import { X } from 'lucide-react'
import {
  Attachment,
  AttachmentMedia,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
} from '@/components/ui/attachment'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { ImageAttachment } from '../shared/contracts'

const source = (id: string) => 'crew-image://image/' + encodeURIComponent(id)
export function ImagePreviews({
  images,
  onRemove,
  disabled = false,
}: {
  images: ImageAttachment[]
  onRemove?: (id: string) => void
  disabled?: boolean
}) {
  const [opened, setOpened] = useState<ImageAttachment | null>(null)
  return (
    <>
      <div className="flex flex-wrap gap-2 py-2">
        {images.map((image) => (
          <Attachment
            key={image.id}
            orientation="vertical"
            className={onRemove ? 'w-24' : 'w-52'}
          >
            <AttachmentMedia variant="image">
              <img src={source(image.id)} alt={image.name} draggable={false} />
            </AttachmentMedia>
            <AttachmentTrigger
              aria-label={'View ' + image.name}
              onClick={() => setOpened(image)}
            />
            {onRemove && (
              <AttachmentActions>
                <AttachmentAction
                  type="button"
                  variant="secondary"
                  aria-label={'Remove ' + image.name}
                  disabled={disabled}
                  onClick={() => onRemove(image.id)}
                >
                  <X />
                </AttachmentAction>
              </AttachmentActions>
            )}
          </Attachment>
        ))}
      </div>
      <Dialog
        open={!!opened}
        onOpenChange={(open) => {
          if (!open) setOpened(null)
        }}
      >
        <DialogContent className="w-auto max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="truncate pr-8">{opened?.name}</DialogTitle>
          {opened && (
            <img
              src={source(opened.id)}
              alt={opened.name}
              className="max-h-[75vh] max-w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
