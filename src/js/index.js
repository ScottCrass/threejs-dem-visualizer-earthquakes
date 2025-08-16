import * as THREE from 'three';
import {
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  AmbientLight,
  WebGLRenderer,
  PlaneGeometry,
  GridHelper,
  TextureLoader,
  MeshLambertMaterial,
  DoubleSide,
  Mesh,
  Raycaster,
  Vector2,
  Clock,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'; // import min because three.js is not tree-shakable for now
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Detector from '../js/vendor/Detector';
// TODO: Major performance problems on reading big images
// import terrain from '../textures/agri-medium-dem.tif';
// import mountainImage from '../textures/agri-medium-autumn.jpg';

import terrain from '../textures/spurr_20_mile_rad_dem_smaller_trimmed.tif';
import mountainImage from '../textures/spurr_round_usgs_sat_overlay.jpg';
import { EarthquakeOverlay } from './earthquakeOverlay';
import { createEarthquakeControls } from './earthquakeControls';
import { createEarthquakeTimeline } from './earthquakeTimeline';

require('../sass/home.sass');

class Application {
  constructor(opts = {}) {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.mouse = new Vector2();
    this.raycaster = new Raycaster();
    this.clock = new Clock();
    
    // Mouse tracking for distinguishing clicks from drags
    this.mouseDownPosition = new Vector2();
    this.mouseUpPosition = new Vector2();
    this.isDragging = false;
    
    // Initialize terrain bounds - will be updated from GeoTIFF metadata
    this.terrainBounds = {
      minLat: 0,
      maxLat: 0,
      minLon: 0,
      maxLon: 0,
      center: { latitude: 0, longitude: 0 }, // Will be calculated from GeoTIFF bounds
      radiusMiles: 0, // Will be calculated from GeoTIFF bounds
      width: 0,   // Will be set after terrain is loaded
      height: 0   // Will be set after terrain is loaded
    };
    
    console.log('Terrain bounds will be extracted from GeoTIFF metadata...');
    
    // Layer for bloom effect
    this.BLOOM_SCENE = 1;
    this.bloomLayer = new THREE.Layers();
    this.bloomLayer.set(this.BLOOM_SCENE);
    
    // Materials for selective bloom
    this.darkMaterial = new THREE.MeshBasicMaterial({ 
      color: 'black',
      transparent: false, // Start as non-transparent
      opacity: 1.0
    });
    this.materials = {};

    if (opts.container) {
      this.container = opts.container;
    } else {
      const div = Application.createContainer();
      document.body.appendChild(div);
      this.container = div;
    }

    // Initialize earthquake overlay
    this.earthquakeOverlay = new EarthquakeOverlay();

    if (Detector.webgl) {
      this.init();
      // Don't setup earthquake overlay here - it will be done after terrain loads
      this.render();
    } else {
      // TODO: style warning message
      console.log('WebGL NOT supported in your browser!');
      const warning = Detector.getWebGLErrorMessage();
      this.container.appendChild(warning);
    }
  }

  init() {
    this.scene = new Scene();
    this.setupCamera();
    this.setupRenderer();
    this.setupControls();
    this.setupLight();
    this.setupTerrainModel();
    this.setupHelpers();

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      // Update renderer size
      this.renderer.setSize(w, h);
      
      // Update camera aspect ratio
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      
      // Update bloom composer if it exists
      if (this.bloomComposer) {
        this.bloomComposer.setSize(w, h);
      }
      if (this.finalComposer) {
        this.finalComposer.setSize(w, h);
      }
    });
    
    // Now that the camera is initialized, set up the bloom effect
    this.setupBloom();
  }

  render() {
    this.controls.update();
    
    // Update compass rotation based on camera direction
    this.updateCompassRotation();
    
    // Selective bloom rendering process with proper terrain opacity handling
    // Step 1: Darken non-bloom objects for bloom pass
    this.scene.traverse(obj => this.darkenNonBloomed(obj));
    this.bloomComposer.render();
    
    // Step 2: Restore original materials
    this.scene.traverse(obj => this.restoreMaterial(obj));
    
    // Step 3: Render final combined result
    this.finalComposer.render();
    
    // Continue animation loop
    requestAnimationFrame(() => this.render());
  }
  
  // Helper functions for selective bloom
  darkenNonBloomed(obj) {
    if (obj.isMesh && this.bloomLayer.test(obj.layers) === false) {
      this.materials[obj.uuid] = obj.material;
      
      // For terrain mesh, create a special dark material that respects opacity
      if (obj.userData && obj.userData.isTerrain) {
        const darkMat = new THREE.MeshBasicMaterial({
          color: 'black',
          transparent: obj.material.transparent,
          opacity: obj.material.opacity,
          alphaTest: obj.material.alphaTest,
          side: obj.material.side,
          depthWrite: obj.material.depthWrite,
          depthTest: obj.material.depthTest
        });
        obj.material = darkMat;
      } else {
        // For other objects, use the standard dark material approach
        const darkMat = this.darkMaterial.clone();
        darkMat.transparent = obj.material.transparent;
        darkMat.opacity = obj.material.opacity;
        darkMat.alphaTest = obj.material.alphaTest;
        obj.material = darkMat;
      }
    }
  }
  
  restoreMaterial(obj) {
    if (this.materials[obj.uuid]) {
      obj.material = this.materials[obj.uuid];
      delete this.materials[obj.uuid];
    }
  }

  static createContainer() {
    const div = document.createElement('div');
    div.setAttribute('id', 'canvas-container');
    div.setAttribute('class', 'container');
    return div;
  }

  setupRenderer() {
    this.renderer = new WebGLRenderer({ 
      antialias: true,
      alpha: false, // Disable alpha to prevent transparency issues
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x0a0a0a, 1.0); // Dark with full alpha
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(this.width, this.height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputEncoding = THREE.sRGBEncoding; // Improved color rendering
    
    // Ensure consistent texture handling
    this.renderer.toneMapping = THREE.NoToneMapping;
    
    this.container.appendChild(this.renderer.domElement);
    
    // Setup bloom effect and composer after the camera is initialized
    // We'll do this at the end of the init method
    
    // Resize handling is now done in the init method
  }
  
  setupBloom() {
    // Proper selective bloom implementation based on Three.js example
    
    const renderScene = new RenderPass(this.scene, this.camera);
    
    // Create bloom pass for selective bloom
    const bloomPass = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      1.5,  // strength
      0.4,  // radius  
      0.1   // threshold - very low to ensure immediate bloom on red earthquakes
    );
    
    this.bloomPass = bloomPass;
    
    // Bloom composer - renders only bloom objects
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(bloomPass);
    
    // Mix pass - combines normal scene with bloom texture
    const mixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          varying vec2 vUv;
          void main() {
            gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
          }
        `,
        defines: {}
      }), 'baseTexture'
    );
    mixPass.needsSwap = true;
    
    // Final composer - combines everything
    this.finalComposer = new EffectComposer(this.renderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(mixPass);
    
    // Configure camera to see both layers
    if (this.camera && this.camera.layers) {
      this.camera.layers.enable(0); // Default layer for terrain
      this.camera.layers.enable(this.BLOOM_SCENE); // Bloom layer for earthquakes
      
      console.log('Selective bloom setup complete');
      console.log('Bloom pass threshold:', bloomPass.threshold);
      console.log('Bloom pass strength:', bloomPass.strength);
    }
  }

  setupCamera() {
    const fov = 750;
    const aspect = this.width / this.height;
    const near = 0.1;
    const far = 100000;
    this.camera = new PerspectiveCamera(fov, aspect, near, far);
    this.camera.position.set(1000, 1000, 1000);
    this.camera.lookAt(this.scene.position);
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = true;
    this.controls.maxDistance = 15000;
    this.controls.minDistance = 0;
    this.controls.autoRotate = false; // Disable automatic rotation
  }

  setupLight() {
    // Main directional light for the terrain
    this.light = new DirectionalLight(0xffffff, 0.8);
    this.light.position.set(500, 1000, 250);
    this.scene.add(this.light);
    
    // Add ambient light to improve visibility of glowing earthquakes
    this.ambientLight = new AmbientLight(0x333333);
    this.scene.add(this.ambientLight);
  }

  setupTerrainModel() {
    const readGeoTif = async () => {
      const rawTiff = await GeoTIFF.fromUrl(terrain);
      const tifImage = await rawTiff.getImage();
      const image = {
        width: tifImage.getWidth(),
        height: tifImage.getHeight(),
      };
      console.log('Image dimensions:', image);
      
      // Extract geographic bounds from GeoTIFF metadata
      const bbox = tifImage.getBoundingBox();
      console.log('GeoTIFF Bounding Box:', bbox);
      
      // Check if we have projection information
      const geoKeys = tifImage.getGeoKeys();
      console.log('GeoTIFF GeoKeys:', geoKeys);
      
      // Check if coordinates are in a projected system (values > 180 indicate projected coordinates)
      const isProjected = Math.abs(bbox[0]) > 180 || Math.abs(bbox[1]) > 180 || Math.abs(bbox[2]) > 180 || Math.abs(bbox[3]) > 180;
      console.log('Is projected coordinate system:', isProjected);
      
      let finalBounds;
      
      if (isProjected) {
        // If projected, we need to fall back to manual bounds for now
        // This is Mount Spurr area in Alaska - using known geographic bounds
        console.log('Using fallback geographic bounds for Mount Spurr area');
        finalBounds = {
          minLon: -152.4,  // West
          minLat: 61.15,   // South  
          maxLon: -152.1,  // East
          maxLat: 61.45    // North
        };
      } else {
        // Direct lat/lon coordinates
        finalBounds = {
          minLon: bbox[0], // West
          minLat: bbox[1], // South  
          maxLon: bbox[2], // East
          maxLat: bbox[3]  // North
        };
      }
      
      // Update terrain bounds with proper geographic bounds
      this.terrainBounds.minLon = finalBounds.minLon;
      this.terrainBounds.minLat = finalBounds.minLat;
      this.terrainBounds.maxLon = finalBounds.maxLon;
      this.terrainBounds.maxLat = finalBounds.maxLat;
      this.terrainBounds.width = image.width;
      this.terrainBounds.height = image.height;
      
      // Calculate center from actual bounds
      this.terrainBounds.center = {
        latitude: (finalBounds.minLat + finalBounds.maxLat) / 2,
        longitude: (finalBounds.minLon + finalBounds.maxLon) / 2
      };
      
      // Calculate radius in miles (approximate)
      const latDiff = finalBounds.maxLat - finalBounds.minLat;
      const lonDiff = finalBounds.maxLon - finalBounds.minLon;
      const latRadius = (latDiff * 69) / 2; // degrees to miles
      const lonRadius = (lonDiff * 54.6) / 2; // approximate for this latitude
      this.terrainBounds.radiusMiles = Math.max(latRadius, lonRadius);
      
      console.log('Updated terrain bounds from GeoTIFF:');
      console.log(`  Center: ${this.terrainBounds.center.latitude}, ${this.terrainBounds.center.longitude}`);
      console.log(`  Bounds: lat(${finalBounds.minLat} to ${finalBounds.maxLat}), lon(${finalBounds.minLon} to ${finalBounds.maxLon})`);
      console.log(`  Approximate radius: ${this.terrainBounds.radiusMiles.toFixed(2)} miles`);
      
      /* 
      The third and fourth parameter are image segments and we are subtracting one from each,
       otherwise our 3D model goes crazy.
       https://github.com/mrdoob/three.js/blob/master/src/geometries/PlaneGeometry.js#L57
       */
      const geometry = new PlaneGeometry(
        image.width,
        image.height,
        image.width - 1,
        image.height - 1
      );
      const data = await tifImage.readRasters({ interleave: true });
      console.time('parseGeom');
      // Get index array from the existing geometry
      const indexAttribute = geometry.getIndex();
      const indices = indexAttribute ? indexAttribute.array : null;
      // If we have indices, we'll create a new array with only valid triangles
      if (indices) {
        const newIndices = [];
        // Process triangles (indices come in groups of 3)
        for (let i = 0; i < indices.length; i += 3) {
          const idx1 = indices[i];
          const idx2 = indices[i + 1];
          const idx3 = indices[i + 2];
          // Only keep triangles where none of the vertices has a value of -9999
          if (data[idx1] !== -9999 && data[idx2] !== -9999 && data[idx3] !== -9999) {
            newIndices.push(idx1, idx2, idx3);
          }
        }
        // Update the geometry with filtered indices
        geometry.setIndex(newIndices);
      }
      // Set Z values for remaining vertices
      const arr1 = new Array(geometry.attributes.position.count);
      const arr = arr1.fill(1);
      arr.forEach((a, index) => {
        geometry.attributes.position.setZ(index, (data[index] / 25) * -1);
      });
      console.timeEnd('parseGeom');

      const texture = new TextureLoader().load(mountainImage);
      const material = new MeshLambertMaterial({
        wireframe: false,
        side: DoubleSide,
        map: texture,
        // Set default brightness to 1.4 for better visibility
        color: 0xf0f0f0, // Brighter base color (1.4x brightness approximation)
        transparent: false, // Start with no transparency
        opacity: 1.0, // Start at full opacity
        alphaTest: 0, // Disable alpha testing
      });

      const mountain = new Mesh(geometry, material);
      mountain.position.y = 0;
      mountain.rotation.x = Math.PI / 2;
      
      // Flip the terrain mesh horizontally to correct the mirror image
      // This ensures the terrain matches the correct geographic orientation
      mountain.scale.x = -1;
      
      // Explicitly ensure the mountain mesh is not in the bloom layer
      mountain.layers.set(0); // Set to default layer (0), not bloom layer
      mountain.userData.isTerrain = true; // Mark as terrain for layer management
      
      // Store reference to terrain mesh for opacity control
      this.terrainMesh = mountain;
      

      this.scene.add(mountain);

      // Now that terrain bounds are set up, initialize the earthquake overlay
      this.setupEarthquakeOverlay();
      
      // Set up terrain opacity control after terrain is created
      this.setupTerrainOpacityControl();
      
      // Set up terrain brightness control after terrain is created
      this.setupTerrainBrightnessControl();

      const loader = document.getElementById('loader');
      loader.style.opacity = '-1';

      // After a proper animation on opacity, hide element to make canvas clickable again
      setTimeout(() => {
        loader.style.display = 'none';
      }, 1500);
    };

    readGeoTif();
  }

  setupHelpers() {
    const gridHelper = new GridHelper(1000, 40, 0x423d36, 0x423d36); // Very dark gray to prevent bloom
    gridHelper.layers.set(1); // Set to default layer, not bloom
    this.scene.add(gridHelper);
    
    // DEBUG: Log grid helper layer
    console.log('Grid helper layers mask:', gridHelper.layers.mask);
    
    // Initialize SVG compass rotation
    this.initCompassRotation();
  }
  
  initCompassRotation() {
    // Initialize compass rotation based on camera direction
    this.compassElement = document.getElementById('compass');
    this.compassDir = new THREE.Vector3();
    this.compassSph = new THREE.Spherical();
    
    if (this.compassElement) {
      console.log('SVG compass initialized for rotation based on camera direction');
    } else {
      console.warn('Compass element not found - will retry after DOM is ready');
    }
  }
    
  updateCompassRotation() {
    if (this.compassElement && this.controls) {

      let azimuthal = this.controls.getAzimuthalAngle();
      let rotation = THREE.MathUtils.radToDeg(azimuthal);

      const polar = this.controls.getPolarAngle();
      if (polar > Math.PI / 2) {
        rotation = -rotation
        rotation -= 180
      }

      rotation = -rotation;
      rotation -= 90;
      rotation *= -1;
      
      rotation -= 270

      rotation = (rotation % 360 + 360) % 360;

      this.compassElement.style.transform = `rotate(${rotation}deg)`;
    }
  }

  configureEarthquakesForClicking() {
    // Configure earthquake objects for interaction after they're created/recreated
    this.earthquakeOverlay.getObject3D().children.forEach((child) => {
      if (child.isMesh && child.userData && child.userData.isEarthquake) {
        // Scaling is now done during creation in earthquakeOverlay.js
        // No additional scaling needed here
        
        // Layer assignment is now done during creation in earthquakeOverlay.js
        // No need to reassign layers here - they should already be correct
        console.log('Earthquake configured - layers mask:', child.layers.mask, '(should be 3 for layers 0+1)');
      }
    });
  }
  
  setupEarthquakeOverlay() {
    // Add the earthquake overlay group to the scene
    this.scene.add(this.earthquakeOverlay.getObject3D());
    
    // Make sure the overlay is visible by default
    this.earthquakeOverlay.getObject3D().visible = true;
    
    // Set the bloom scene layer for the earthquake overlay
    this.earthquakeOverlay.setBloomLayer(this.BLOOM_SCENE);
    
    // Add earthquake controls to the DOM
    const controls = createEarthquakeControls();
    document.body.appendChild(controls);
    
    // Add timeline controls
    const timeline = createEarthquakeTimeline(this.earthquakeOverlay, this.terrainBounds);
    document.body.appendChild(timeline);
    
    // Initialize compass rotation now that DOM elements are ready
    if (!this.compassElement) {
      this.initCompassRotation();
    }
    
    // Set up callback to reconfigure earthquakes whenever they're visualized
    this.earthquakeOverlay.onVisualize = () => {
      this.configureEarthquakesForClicking();
    };
    
    // Configure the bloom layer
    this.bloomLayer.set(this.BLOOM_SCENE);
    
    // Load earthquake data - use default one week period for initial load
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const startDate = oneWeekAgo.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0]; // Today
    
    this.earthquakeOverlay.loadData(this.terrainBounds, startDate, endDate)
      .then(() => {
        // After data is loaded, visualize it with time filtering
        this.earthquakeOverlay.visualize(this.terrainBounds, this.earthquakeOverlay.currentTime);
        console.log('Earthquake data visualized');
        
        // Configure earthquake objects for interaction
        this.configureEarthquakesForClicking();
      })
      .catch(error => {
        console.error('Failed to load earthquake data:', error);
      });
      
    // Add mouse handlers for distinguishing clicks from drags
    this.renderer.domElement.addEventListener('mousedown', (event) => {
      // Update window dimensions in case they changed
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      
      // Record mouse down position
      this.mouseDownPosition.x = event.clientX;
      this.mouseDownPosition.y = event.clientY;
      this.isDragging = false;
    });
    
    this.renderer.domElement.addEventListener('mousemove', (event) => {
      // Update window dimensions in case they changed
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      
      // Calculate mouse position in normalized device coordinates (-1 to +1)
      this.mouse.x = (event.clientX / this.width) * 2 - 1;
      this.mouse.y = -(event.clientY / this.height) * 2 + 1;
      
      // Check if we're dragging (mouse moved more than 5 pixels from mousedown position)
      if (this.mouseDownPosition) {
        const deltaX = Math.abs(event.clientX - this.mouseDownPosition.x);
        const deltaY = Math.abs(event.clientY - this.mouseDownPosition.y);
        if (deltaX > 5 || deltaY > 5) {
          this.isDragging = true;
        }
      }
    });
    
    this.renderer.domElement.addEventListener('mouseup', (event) => {
      // Update window dimensions in case they changed
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      
      // Record mouse up position
      this.mouseUpPosition.x = event.clientX;
      this.mouseUpPosition.y = event.clientY;
      
      // Only trigger click logic if we weren't dragging
      if (!this.isDragging) {
        // Calculate mouse position for click event
        this.mouse.x = (event.clientX / this.width) * 2 - 1;
        this.mouse.y = -(event.clientY / this.height) * 2 + 1;
        
        // DEBUG: Log click event details
        console.log('Click event - clientX:', event.clientX, 'clientY:', event.clientY);
        console.log('Window dimensions:', this.width, 'x', this.height);
        console.log('Calculated mouse coords:', this.mouse.x, this.mouse.y);
        
        this.checkEarthquakeIntersection();
      } else {
        console.log('Drag detected, skipping earthquake intersection check');
      }
      
      // Reset drag state
      this.isDragging = false;
    });
    
    // Listen for bloom strength change events
    document.addEventListener('bloomStrengthChange', (event) => {
      // Update the bloom pass strength directly
      if (this.bloomPass) {
        this.bloomPass.strength = event.detail.strength;
        console.log("Bloom strength set to:", event.detail.strength);
        
        // Don't adjust individual earthquake colors here - let age-based colors handle that
        // The bloom pass strength adjustment is sufficient for controlling glow intensity
      }
    });
    
    // Add event listener for loading earthquake data with custom date range
    document.addEventListener('loadEarthquakeData', (event) => {
      const { startDate, endDate } = event.detail;
      console.log(`Loading earthquake data from ${startDate} to ${endDate}`);
      
      // Clear existing earthquake objects
      this.earthquakeOverlay.clearData();
      
      // Load new data with the specified date range
      this.earthquakeOverlay.loadData(this.terrainBounds, startDate, endDate)
        .then(() => {
          // After data is loaded, visualize it
          this.earthquakeOverlay.visualize(this.terrainBounds, this.earthquakeOverlay.currentTime);
          console.log(`Earthquake data loaded and visualized for period ${startDate} to ${endDate}`);
          
          // Configure earthquake objects for interaction
          this.configureEarthquakesForClicking();
        })
        .catch(error => {
          console.error('Failed to load earthquake data for date range:', error);
        });
    });
  }
  
  setupTerrainOpacityControl() {
    // Listen for terrain opacity change events
    document.addEventListener('terrainOpacityChange', (event) => {
      // Update terrain material opacity using direct reference
      if (this.terrainMesh && this.terrainMesh.material) {
        const opacity = event.detail.opacity;
        console.log("Setting terrain opacity to:", opacity);
        console.log("Before - material opacity:", this.terrainMesh.material.opacity);
        console.log("Before - material transparent:", this.terrainMesh.material.transparent);
        
        // Set transparency based on opacity value
        if (opacity < 1.0) {
          this.terrainMesh.material.transparent = true;
          this.terrainMesh.material.alphaTest = 0;
        } else {
          // When opacity is 1.0, disable transparency for full opacity
          this.terrainMesh.material.transparent = false;
          this.terrainMesh.material.alphaTest = 0;
        }
        
        this.terrainMesh.material.opacity = opacity;
        this.terrainMesh.material.needsUpdate = true;
        
        console.log("After - material opacity:", this.terrainMesh.material.opacity);
        console.log("After - material transparent:", this.terrainMesh.material.transparent);
        console.log("Material type:", this.terrainMesh.material.type);
        
        // Force a complete renderer state update to ensure changes take effect
        this.renderer.state.reset();
        
        // Also invalidate any cached materials in the bloom system
        this.materials = {};
      } else {
        console.log("Terrain mesh not found for opacity change");
      }
    });
  }
  
  setupTerrainBrightnessControl() {
    // Store the original color for brightness adjustments
    if (this.terrainMesh && this.terrainMesh.material && !this.terrainOriginalColor) {
      this.terrainOriginalColor = this.terrainMesh.material.color.clone();
    }
    
    // Listen for terrain brightness change events
    document.addEventListener('terrainBrightnessChange', (event) => {
      // Update terrain material brightness using direct reference
      if (this.terrainMesh && this.terrainMesh.material && this.terrainOriginalColor) {
        const brightness = event.detail.brightness;
        console.log("Setting terrain brightness to:", brightness);
        
        // Adjust brightness by modifying the material color
        const newColor = this.terrainOriginalColor.clone();
        newColor.multiplyScalar(brightness);
        
        this.terrainMesh.material.color = newColor;
        this.terrainMesh.material.needsUpdate = true;
        
        console.log("Terrain brightness updated to:", brightness);
        console.log("New color RGB:", newColor.r.toFixed(3), newColor.g.toFixed(3), newColor.b.toFixed(3));
      } else {
        console.log("Terrain mesh or original color not found for brightness change");
      }
    });
  }
  
  checkEarthquakeIntersection() {
    console.log('Click detected - checking earthquake intersection');
    
    // Only check if the overlay group is visible
    if (!this.earthquakeOverlay.getObject3D().visible) {
      console.log('Earthquake overlay not visible, skipping intersection check');
      return;
    }
    
    // Two-click system: First click pauses timeline, second click selects earthquake
    if (this.earthquakeOverlay.isPlaying) {
      // First click - pause the timeline
      console.log('First click: pausing timeline');
      this.earthquakeOverlay.pause();
      return; // Don't check for earthquake intersection on first click
    }
    
    // Second click (timeline already paused) - check for earthquake selection
    console.log('Second click: checking for earthquake selection');
    
    // Update the picking ray with the camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Configure raycaster to work with both layers (earthquakes are on layers 0 and bloom)
    this.raycaster.layers.enableAll(); // Enable all layers for intersection testing
    
    // Get all earthquake objects for intersection testing
    const earthquakeObjects = [];
    this.earthquakeOverlay.getObject3D().children.forEach((child) => {
      if (child.isMesh && child.userData?.isEarthquake) {
        earthquakeObjects.push(child);
      }
    });
    
    console.log(`Found ${earthquakeObjects.length} earthquake objects for intersection testing`);
    
    // Test for intersections with earthquake objects specifically
    const intersects = this.raycaster.intersectObjects(earthquakeObjects, false);
    const infoDiv = document.getElementById('earthquake-info');
    
    console.log(`Raycaster found ${intersects.length} intersections with earthquakes`);
    
    if (infoDiv) {
      if (intersects.length > 0) {
        const earthquakeObject = intersects[0];
        const earthquake = earthquakeObject.object.userData.earthquake;
        
        if (earthquake) {
          // Pause the timeline when an earthquake is clicked for better interaction
          console.log('Earthquake clicked, pausing timeline. Was playing:', this.earthquakeOverlay.isPlaying);
          this.earthquakeOverlay.pause();
          console.log('Timeline paused. Now playing:', this.earthquakeOverlay.isPlaying);
          
          // Build the popup content with earthquake details
          let popupContent = `
            <strong>${earthquake.place || 'Unknown location'}</strong><br>
            Magnitude: ${earthquake.mag}<br>
            Depth: ${earthquakeObject.object.userData.depth.toFixed(2)} km<br>
            Time: ${new Date(earthquake.time).toLocaleString()}<br>
          `;
          
          // Add USGS link if available
          if (earthquake.url) {
            popupContent += `<br><a href="${earthquake.url}" target="_blank" style="color: #0066cc; text-decoration: underline;">View at USGS.GOV</a>`;
          }
          
          infoDiv.style.display = 'block';
          infoDiv.innerHTML = popupContent;
          
          // Highlight the clicked earthquake temporarily
          const originalColor = earthquakeObject.object.material.color.clone();
          earthquakeObject.object.material.color.setRGB(1, 1, 1); // White highlight
          setTimeout(() => {
            earthquakeObject.object.material.color.copy(originalColor);
          }, 1000);
        }
      } else {
        console.log('No earthquake intersections found');
        infoDiv.style.display = 'none';
      }
    }
  }
}

(() => {
  const app = new Application({
    container: document.getElementById('canvas-container'),
  });
  console.log(app);
})();
