(() => {
  const STYLE_ID = 'math-error-notebook-drag-image-upload-style';
  const BOUND_ATTR = 'data-drag-image-upload-bound';

  const injectStyle = () => {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .mn-drag-image-zone {
        border-radius: 16px;
        transition: background-color 160ms ease, outline-color 160ms ease, box-shadow 160ms ease;
      }

      .mn-drag-image-zone.mn-drag-image-over {
        background: rgba(239, 246, 255, 0.85) !important;
        outline: 2px dashed #2563eb;
        outline-offset: 4px;
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
      }

      .mn-drag-image-label {
        position: relative;
      }

      .mn-drag-image-label.mn-drag-image-over::after {
        content: '松手即可添加图片';
        position: absolute;
        inset: 8px;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: rgba(37, 99, 235, 0.92);
        color: #fff;
        font-size: 13px;
        font-weight: 800;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  };

  const getImageFiles = (fileList) => {
    return Array.from(fileList || []).filter(file => file.type && file.type.startsWith('image/'));
  };

  const setFilesToInput = (input, files) => {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const findDropZone = (input) => {
    const label = input.closest('label');
    if (!label) return null;

    return {
      label,
      zone: label.parentElement || label,
    };
  };

  const bindOneInput = (input) => {
    if (input.getAttribute(BOUND_ATTR) === 'true') return;
    if (input.type !== 'file') return;
    if (!input.multiple) return;
    if (!String(input.accept || '').includes('image')) return;

    const target = findDropZone(input);
    if (!target) return;

    input.setAttribute(BOUND_ATTR, 'true');
    const { label, zone } = target;
    label.classList.add('mn-drag-image-label');
    zone.classList.add('mn-drag-image-zone');

    let dragDepth = 0;

    const showActive = () => {
      label.classList.add('mn-drag-image-over');
      zone.classList.add('mn-drag-image-over');
    };

    const hideActive = () => {
      dragDepth = 0;
      label.classList.remove('mn-drag-image-over');
      zone.classList.remove('mn-drag-image-over');
    };

    const preventBrowserOpen = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDragEnter = (event) => {
      preventBrowserOpen(event);
      dragDepth += 1;
      showActive();
    };

    const handleDragOver = (event) => {
      preventBrowserOpen(event);
      event.dataTransfer.dropEffect = 'copy';
      showActive();
    };

    const handleDragLeave = (event) => {
      preventBrowserOpen(event);
      dragDepth -= 1;
      if (dragDepth <= 0) hideActive();
    };

    const handleDrop = (event) => {
      preventBrowserOpen(event);
      hideActive();

      const imageFiles = getImageFiles(event.dataTransfer.files);
      if (!imageFiles.length) {
        alert('请拖入图片文件');
        return;
      }

      try {
        setFilesToInput(input, imageFiles);
      } catch (error) {
        console.error('拖拽添加图片失败：', error);
        alert('拖拽添加失败，请改用点击“添加图片”选择文件');
      }
    };

    [label, zone].forEach(el => {
      el.addEventListener('dragenter', handleDragEnter);
      el.addEventListener('dragover', handleDragOver);
      el.addEventListener('dragleave', handleDragLeave);
      el.addEventListener('drop', handleDrop);
    });
  };

  const bindAllImageInputs = () => {
    injectStyle();
    document
      .querySelectorAll('input[type="file"][accept*="image"][multiple]')
      .forEach(bindOneInput);
  };

  const start = () => {
    bindAllImageInputs();

    const root = document.getElementById('root') || document.body;
    const observer = new MutationObserver(bindAllImageInputs);
    observer.observe(root, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
