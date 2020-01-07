/* eslint-env browser, node */
import PropTypes from 'prop-types'
import React from 'react'
import ReactDOM from 'react-dom'
import get from 'lodash/get'

import loadImageURL from './utils/load-image-url'
import loadImageFile from './utils/load-image-file'

const makeCancelable = promise => {
  let hasCanceled_ = false

  const wrappedPromise = new Promise((resolve, reject) => {
    /* eslint-disable prefer-promise-reject-errors */
    promise.then(
      val => (hasCanceled_ ? reject({ isCanceled: true }) : resolve(val)),
      error => (hasCanceled_ ? reject({ isCanceled: true }) : reject(error))
    )
  })

  return {
    promise: wrappedPromise,
    cancel() {
      hasCanceled_ = true
    },
  }
}

const isTouchDevice = !!(
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  ('ontouchstart' in window || navigator.msMaxTouchPoints > 0)
)

const isFileAPISupported = typeof File !== 'undefined'

const isPassiveSupported = () => {
  // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
  let passiveSupported = false
  try {
    const options = Object.defineProperty({}, 'passive', {
      get: function() {
        passiveSupported = true
      },
    })

    window.addEventListener('test', options, options)
    window.removeEventListener('test', options, options)
  } catch (err) {
    passiveSupported = false
  }
  return passiveSupported
}

const draggableEvents = {
  touch: {
    react: {
      down: 'onTouchStart',
      mouseDown: 'onMouseDown',
      drag: 'onTouchMove',
      move: 'onTouchMove',
      mouseMove: 'onMouseMove',
      up: 'onTouchEnd',
      mouseUp: 'onMouseUp',
    },
    native: {
      down: 'touchstart',
      mouseDown: 'mousedown',
      drag: 'touchmove',
      move: 'touchmove',
      mouseMove: 'mousemove',
      up: 'touchend',
      mouseUp: 'mouseup',
    },
  },
  desktop: {
    react: {
      down: 'onMouseDown',
      drag: 'onDragOver',
      move: 'onMouseMove',
      up: 'onMouseUp',
    },
    native: {
      down: 'mousedown',
      drag: 'dragStart',
      move: 'mousemove',
      up: 'mouseup',
    },
  },
}
const deviceEvents = isTouchDevice
  ? draggableEvents.touch
  : draggableEvents.desktop

let pixelRatio =
  typeof window !== 'undefined' && window.devicePixelRatio
    ? window.devicePixelRatio
    : 1

// Draws a rounded rectangle on a 2D context.
const drawRoundedRect = (context, x, y, width, height, borderRadius) => {
  if (borderRadius === 0) {
    context.rect(x, y, width, height)
  } else {
    const widthMinusRad = width - borderRadius
    const heightMinusRad = height - borderRadius
    context.translate(x, y)
    context.arc(
      borderRadius,
      borderRadius,
      borderRadius,
      Math.PI,
      Math.PI * 1.5
    )
    context.lineTo(widthMinusRad, 0)
    context.arc(
      widthMinusRad,
      borderRadius,
      borderRadius,
      Math.PI * 1.5,
      Math.PI * 2
    )
    context.lineTo(width, heightMinusRad)
    context.arc(
      widthMinusRad,
      heightMinusRad,
      borderRadius,
      Math.PI * 2,
      Math.PI * 0.5
    )
    context.lineTo(borderRadius, height)
    context.arc(
      borderRadius,
      heightMinusRad,
      borderRadius,
      Math.PI * 0.5,
      Math.PI
    )
    context.translate(-x, -y)
  }
}

/**
 * Side extension for Bleeds. It draws the cut lines
 * @param {object} context [canvas context]
 * @param {number} outerBoxX [x pos of rectangle that forms the semi-transparent border] 
 * @param {number} outerBoxY [y pos of rectangle that forms the semi-transparent border]
 * @param {number} innerBoxWidth [width of rectangle that holds the image]
 * @param {number} innerBoxHeight [height of rectangle that holds the image]
*/
const drawCutLines = (context, outerBoxX, outerBoxY, innerBoxWidth, innerBoxHeight, bleedDistance, bleedEdges) => {
  const bleedTop = bleedEdges.top ? bleedDistance : 0
  const bleedRight = bleedEdges.right ? bleedDistance : 0
  const bleedBottom = bleedEdges.bottom ? bleedDistance : 0
  const bleedLeft = bleedEdges.left ? bleedDistance : 0

  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.setLineDash([7, 3]);

  // top 
  context.beginPath();
  context.moveTo(0, outerBoxY + bleedTop);
  context.lineTo(innerBoxWidth, outerBoxY + bleedTop);
  context.stroke();
  context.closePath();

  // right
  context.beginPath();
  context.moveTo(innerBoxWidth - outerBoxX - bleedRight, 0);
  context.lineTo(innerBoxWidth - outerBoxX - bleedRight, innerBoxHeight);
  context.stroke();
  context.closePath();

  // bottom
  context.beginPath();
  context.moveTo(0, innerBoxHeight - outerBoxY - bleedBottom);
  context.lineTo(innerBoxWidth, innerBoxHeight - outerBoxY - bleedBottom);
  context.stroke();
  context.closePath();

  // left
  context.beginPath();
  context.moveTo(outerBoxX + bleedLeft, 0);
  context.lineTo(outerBoxX + bleedLeft, innerBoxHeight);
  context.stroke();
  context.closePath();
}

/**
 * Side extension for Bleeds. It draws the bleed rectangle by using the semi-transparent border's
 * x, y position as the top, left of the rectangle, and using the image container as the height and
 * width of the rectangle.
 * @param {object} context [canvas context]
 * @param {number} outerBoxX [x pos of rectangle that forms the semi-transparent border] 
 * @param {number} outerBoxY [y pos of rectangle that forms the semi-transparent border]
 * @param {number} innerBoxWidth [width of rectangle that holds the image]
 * @param {number} innerBoxHeight [height of rectangle that holds the image]
*/
const drawBleedRect = (context, outerBoxX, outerBoxY, innerBoxWidth, innerBoxHeight) => {
  context.strokeStyle = '#E03F6F';
  context.lineWidth = 2;
  context.setLineDash([]);

  context.beginPath();
  context.strokeRect(outerBoxX, outerBoxY, innerBoxWidth, innerBoxHeight);
  context.closePath();
}

const defaultEmptyImage = {
  x: 0.5,
  y: 0.5,
}

class AvatarEditor extends React.Component {
  static propTypes = {
    printMarks: PropTypes.object,
    scale: PropTypes.number,
    rotate: PropTypes.number,
    image: PropTypes.oneOfType([
      PropTypes.string,
      ...(isFileAPISupported ? [PropTypes.instanceOf(File)] : []),
    ]),
    border: PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.arrayOf(PropTypes.number),
    ]),
    borderRadius: PropTypes.number,
    width: PropTypes.number,
    height: PropTypes.number,
    position: PropTypes.shape({
      x: PropTypes.number,
      y: PropTypes.number,
    }),
    color: PropTypes.arrayOf(PropTypes.number),
    crossOrigin: PropTypes.oneOf(['', 'anonymous', 'use-credentials']),

    onLoadFailure: PropTypes.func,
    onLoadSuccess: PropTypes.func,
    onImageReady: PropTypes.func,
    onImageChange: PropTypes.func,
    onMouseUp: PropTypes.func,
    onMouseMove: PropTypes.func,
    onPositionChange: PropTypes.func,
    disableBoundaryChecks: PropTypes.bool,
    disableHiDPIScaling: PropTypes.bool,
  }

  static defaultProps = {
    printMarks: {},
    scale: 1,
    rotate: 0,
    border: 25,
    borderRadius: 0,
    width: 200,
    height: 200,
    color: [0, 0, 0, 0.5],
    onLoadFailure() {},
    onLoadSuccess() {},
    onImageReady() {},
    onImageChange() {},
    onMouseUp() {},
    onMouseMove() {},
    onPositionChange() {},
    disableBoundaryChecks: false,
    disableHiDPIScaling: false,
  }

  state = {
    drag: false,
    my: null,
    mx: null,
    image: defaultEmptyImage,
  }

  componentDidMount() {
    // scaling by the devicePixelRatio can impact performance on mobile as it creates a very large canvas. This is an override to increase performance.
    if (this.props.disableHiDPIScaling) {
      pixelRatio = 1
    }
    // eslint-disable-next-line react/no-find-dom-node
    const context = ReactDOM.findDOMNode(this.canvas).getContext('2d')
    if (this.props.image) {
      this.loadImage(this.props.image)
    }
    this.paint(context)
    if (document) {
      const passiveSupported = isPassiveSupported()
      const thirdArgument = passiveSupported ? { passive: false } : false

      const nativeEvents = deviceEvents.native
      document.addEventListener(
        nativeEvents.move,
        this.handleMouseMove,
        thirdArgument
      )
      document.addEventListener(
        nativeEvents.up,
        this.handleMouseUp,
        thirdArgument
      )
      if (isTouchDevice) {
        document.addEventListener(
          nativeEvents.mouseMove,
          this.handleMouseMove,
          thirdArgument
        )
        document.addEventListener(
          nativeEvents.mouseUp,
          this.handleMouseUp,
          thirdArgument
        )
      }
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      (this.props.image && this.props.image !== prevProps.image) ||
      this.props.width !== prevProps.width ||
      this.props.height !== prevProps.height
    ) {
      this.loadImage(this.props.image)
    } else if (!this.props.image) {
      this.clearImage()
    }

    // eslint-disable-next-line react/no-find-dom-node
    const canvas = ReactDOM.findDOMNode(this.canvas)
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    this.paint(context)
    this.paintImage(context, this.state.image, this.props.border)

    if (
      prevProps.image !== this.props.image ||
      prevProps.width !== this.props.width ||
      prevProps.height !== this.props.height ||
      prevProps.position !== this.props.position ||
      prevProps.scale !== this.props.scale ||
      prevProps.rotate !== this.props.rotate ||
      prevState.my !== this.state.my ||
      prevState.mx !== this.state.mx ||
      prevState.image.x !== this.state.image.x ||
      prevState.image.y !== this.state.image.y
    ) {
      this.props.onImageChange()
    }
  }

  componentWillUnmount() {
    if (document) {
      const nativeEvents = deviceEvents.native
      document.removeEventListener(
        nativeEvents.move,
        this.handleMouseMove,
        false
      )
      document.removeEventListener(nativeEvents.up, this.handleMouseUp, false)
      if (isTouchDevice) {
        document.removeEventListener(
          nativeEvents.mouseMove,
          this.handleMouseMove,
          false
        )
        document.removeEventListener(
          nativeEvents.mouseUp,
          this.handleMouseUp,
          false
        )
      }
    }
  }

  isVertical() {
    return this.props.rotate % 180 !== 0
  }

  getBorders(border = this.props.border) {
    return Array.isArray(border) ? border : [border, border]
  }

  getDimensions() {
    const { width, height, rotate, border } = this.props

    const canvas = {}

    const [borderX, borderY] = this.getBorders(border)

    const canvasWidth = width
    const canvasHeight = height

    if (this.isVertical()) {
      canvas.width = canvasHeight
      canvas.height = canvasWidth
    } else {
      canvas.width = canvasWidth
      canvas.height = canvasHeight
    }

    canvas.width += borderX * 2
    canvas.height += borderY * 2

    return {
      canvas,
      rotate,
      width,
      height,
      border,
    }
  }

  getImage() {
    // get relative coordinates (0 to 1)
    const cropRect = this.getCroppingRect()
    const image = this.state.image

    // get actual pixel coordinates
    cropRect.x *= image.resource.width
    cropRect.y *= image.resource.height
    cropRect.width *= image.resource.width
    cropRect.height *= image.resource.height

    // create a canvas with the correct dimensions
    const canvas = document.createElement('canvas')

    if (this.isVertical()) {
      canvas.width = cropRect.height
      canvas.height = cropRect.width
    } else {
      canvas.width = cropRect.width
      canvas.height = cropRect.height
    }

    // draw the full-size image at the correct position,
    // the image gets truncated to the size of the canvas.
    const context = canvas.getContext('2d')

    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((this.props.rotate * Math.PI) / 180)
    context.translate(-(canvas.width / 2), -(canvas.height / 2))

    if (this.isVertical()) {
      context.translate(
        (canvas.width - canvas.height) / 2,
        (canvas.height - canvas.width) / 2
      )
    }

    context.drawImage(image.resource, -cropRect.x, -cropRect.y)

    return canvas
  }

  /**
   * Get the image scaled to original canvas size.
   * This was default in 4.x and is now kept as a legacy method.
   */
  getImageScaledToCanvas() {
    const { width, height } = this.getDimensions()

    const canvas = document.createElement('canvas')

    if (this.isVertical()) {
      canvas.width = height
      canvas.height = width
    } else {
      canvas.width = width
      canvas.height = height
    }

    // don't paint a border here, as it is the resulting image
    this.paintImage(canvas.getContext('2d'), this.state.image, 0, 1)

    return canvas
  }

  getXScale() {
    const canvasAspect = this.props.width / this.props.height
    const imageAspect = this.state.image.width / this.state.image.height

    return Math.min(1, canvasAspect / imageAspect)
  }

  getYScale() {
    const canvasAspect = this.props.height / this.props.width
    const imageAspect = this.state.image.height / this.state.image.width

    return Math.min(1, canvasAspect / imageAspect)
  }

  getCroppingRect() {
    const position = this.props.position || {
      x: this.state.image.x,
      y: this.state.image.y,
    }
    const width = (1 / this.props.scale) * this.getXScale()
    const height = (1 / this.props.scale) * this.getYScale()

    const croppingRect = {
      x: position.x - width / 2,
      y: position.y - height / 2,
      width,
      height,
    }

    let xMin = 0
    let xMax = 1 - croppingRect.width
    let yMin = 0
    let yMax = 1 - croppingRect.height

    // If the cropping rect is larger than the image, then we need to change
    // our maxima & minima for x & y to allow the image to appear anywhere up
    // to the very edge of the cropping rect.
    const isLargerThanImage =
      this.props.disableBoundaryChecks || width > 1 || height > 1

    if (isLargerThanImage) {
      xMin = -croppingRect.width
      xMax = 1
      yMin = -croppingRect.height
      yMax = 1
    }

    return {
      ...croppingRect,
      x: Math.max(xMin, Math.min(croppingRect.x, xMax)),
      y: Math.max(yMin, Math.min(croppingRect.y, yMax)),
    }
  }

  loadImage(image) {
    if (isFileAPISupported && image instanceof File) {
      this.loadingImage = makeCancelable(loadImageFile(image))
        .promise.then(this.handleImageReady)
        .catch(this.props.onLoadFailure)
    } else if (typeof image === 'string') {
      this.loadingImage = makeCancelable(
        loadImageURL(image, this.props.crossOrigin)
      )
        .promise.then(this.handleImageReady)
        .catch(this.props.onLoadFailure)
    }
  }

  handleImageReady = image => {
    const imageState = this.getInitialSize(image.width, image.height)
    imageState.resource = image
    imageState.x = 0.5
    imageState.y = 0.5
    this.setState({ drag: false, image: imageState }, this.props.onImageReady)
    this.props.onLoadSuccess(imageState)
  }

  getInitialSize(width, height) {
    let newHeight
    let newWidth

    const dimensions = this.getDimensions()
    const canvasRatio = dimensions.height / dimensions.width
    const imageRatio = height / width

    if (canvasRatio > imageRatio) {
      newHeight = this.getDimensions().height
      newWidth = width * (newHeight / height)
    } else {
      newWidth = this.getDimensions().width
      newHeight = height * (newWidth / width)
    }

    return {
      height: newHeight,
      width: newWidth,
    }
  }

  clearImage = () => {
    const canvas = this.canvas
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    this.setState({
      image: defaultEmptyImage,
    })
  }

  paintImage(context, image, border, scaleFactor = pixelRatio) {
    if (image.resource) {
      const position = this.calculatePosition(image, border)

      context.save()

      context.translate(context.canvas.width / 2, context.canvas.height / 2)
      context.rotate((this.props.rotate * Math.PI) / 180)
      context.translate(
        -(context.canvas.width / 2),
        -(context.canvas.height / 2)
      )

      if (this.isVertical()) {
        context.translate(
          (context.canvas.width - context.canvas.height) / 2,
          (context.canvas.height - context.canvas.width) / 2
        )
      }

      context.scale(scaleFactor, scaleFactor)

      context.globalCompositeOperation = 'destination-over'
      context.drawImage(
        image.resource,
        position.x,
        position.y,
        position.width,
        position.height
      )

      context.restore()
    }
  }

  calculatePosition(image, border) {
    image = image || this.state.image

    const [borderX, borderY] = this.getBorders(border)

    const croppingRect = this.getCroppingRect()
    const width = image.width * this.props.scale
    const height = image.height * this.props.scale

    let x = -croppingRect.x * width
    let y = -croppingRect.y * height

    if (this.isVertical()) {
      x += borderY
      y += borderX
    } else {
      x += borderX
      y += borderY
    }

    return {
      x,
      y,
      height,
      width,
    }
  }

  paint(context) {
    context.save()
    context.scale(pixelRatio, pixelRatio)
    context.translate(0, 0)
    context.fillStyle = 'rgba(' + this.props.color.slice(0, 4).join(',') + ')'

    let borderRadius = this.props.borderRadius
    const dimensions = this.getDimensions()
    const [borderSizeX, borderSizeY] = this.getBorders(dimensions.border)
    const height = dimensions.canvas.height
    const width = dimensions.canvas.width
    const bleedDistance = get(this.props, 'printMarks.bleedDistance', 0)
    const bleedEdges = get(this.props, 'printMarks.bleedEdges')

    // clamp border radius between zero (perfect rectangle) and half the size without borders (perfect circle or "pill")
    borderRadius = Math.max(borderRadius, 0)
    borderRadius = Math.min(
      borderRadius,
      width / 2 - borderSizeX,
      height / 2 - borderSizeY
    )
    
    context.beginPath()
    // inner rect, possibly rounded
    drawRoundedRect(
      context,
      borderSizeX,
      borderSizeY,
      width - borderSizeX * 2,
      height - borderSizeY * 2,
      borderRadius
    )
    context.rect(width, 0, -width, height) // outer rect, drawn "counterclockwise"
    context.fill('evenodd')

    // draw the print marks if the bleed edges exist
    if (bleedEdges) {
      // white dotted line
      drawCutLines(
        context, 
        borderSizeX,
        borderSizeY,
        width, 
        height,
        bleedDistance,
        bleedEdges
      )
  
      // red border
      drawBleedRect(
        context, 
        borderSizeX,
        borderSizeY,
        width - borderSizeX * 2,
        height - borderSizeY * 2
      )
    }

    context.restore()
  }

  handleMouseDown = e => {
    e = e || window.event
    // if e is a touch event, preventDefault keeps
    // corresponding mouse events from also being fired
    // later.
    e.preventDefault()
    this.setState({
      drag: true,
      mx: null,
      my: null,
    })
  }
  handleMouseUp = () => {
    if (this.state.drag) {
      this.setState({ drag: false })
      this.props.onMouseUp()
    }
  }

  handleMouseMove = e => {
    e = e || window.event
    if (this.state.drag === false) {
      return
    }

    e.preventDefault() // stop scrolling on iOS Safari

    const mousePositionX = e.targetTouches
      ? e.targetTouches[0].pageX
      : e.clientX
    const mousePositionY = e.targetTouches
      ? e.targetTouches[0].pageY
      : e.clientY

    const newState = {
      mx: mousePositionX,
      my: mousePositionY,
    }

    let rotate = this.props.rotate

    rotate %= 360
    rotate = rotate < 0 ? rotate + 360 : rotate

    if (this.state.mx && this.state.my) {
      const mx = this.state.mx - mousePositionX
      const my = this.state.my - mousePositionY

      const width = this.state.image.width * this.props.scale
      const height = this.state.image.height * this.props.scale

      let { x: lastX, y: lastY } = this.getCroppingRect()

      lastX *= width
      lastY *= height

      // helpers to calculate vectors
      const toRadians = degree => degree * (Math.PI / 180)
      const cos = Math.cos(toRadians(rotate))
      const sin = Math.sin(toRadians(rotate))

      const x = lastX + mx * cos + my * sin
      const y = lastY + -mx * sin + my * cos

      const relativeWidth = (1 / this.props.scale) * this.getXScale()
      const relativeHeight = (1 / this.props.scale) * this.getYScale()

      const position = {
        x: x / width + relativeWidth / 2,
        y: y / height + relativeHeight / 2,
      }

      this.props.onPositionChange(position)

      newState.image = {
        ...this.state.image,
        ...position,
      }
    }

    this.setState(newState)

    this.props.onMouseMove(e)
  }

  setCanvas = canvas => {
    this.canvas = canvas
  }

  render() {
    const {
      printMarks,
      scale,
      rotate,
      image,
      border,
      borderRadius,
      width,
      height,
      position,
      color,
      /* eslint-disable react/prop-types */
      style,
      crossOrigin,
      onLoadFailure,
      onLoadSuccess,
      onImageReady,
      onImageChange,
      onMouseUp,
      onMouseMove,
      onPositionChange,
      disableBoundaryChecks,
      disableHiDPIScaling,
      ...rest
    } = this.props

    const dimensions = this.getDimensions()
    const defaultStyle = {
      width: dimensions.canvas.width,
      height: dimensions.canvas.height,
      cursor: this.state.drag ? 'grabbing' : 'grab',
      touchAction: 'none',
    }

    const attributes = {
      width: dimensions.canvas.width * pixelRatio,
      height: dimensions.canvas.height * pixelRatio,
      style: {
        ...defaultStyle,
        ...style,
      },
    }

    attributes[deviceEvents.react.down] = this.handleMouseDown
    if (isTouchDevice) {
      attributes[deviceEvents.react.mouseDown] = this.handleMouseDown
    }

    return <canvas ref={this.setCanvas} {...attributes} {...rest} />
  }
}

export default AvatarEditor
