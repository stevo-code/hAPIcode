/** Poignee de redimensionnement : appelle onResize(clientX) pendant le glisser. */
export function Resizer({ onResize }: { onResize: (clientX: number) => void }): JSX.Element {
  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    const move = (ev: MouseEvent): void => onResize(ev.clientX)
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  return <div className="resizer" onMouseDown={onMouseDown} />
}
