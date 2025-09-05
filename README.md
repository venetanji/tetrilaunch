# Tetrilaunch 🚀

A unique physics-based puzzle game that combines Tetris pieces with cannon mechanics! Launch colorful Tetris pieces from a cannon and watch them interact with realistic physics simulation.

![Tetrilaunch Game](https://img.shields.io/badge/Python-3.7+-blue.svg)
![Pygame](https://img.shields.io/badge/Pygame-2.0+-green.svg)
![Pymunk](https://img.shields.io/badge/Pymunk-Physics-red.svg)

## 🎮 Game Overview

Tetrilaunch is an innovative twist on classic puzzle games where you:
- **Aim and shoot** Tetris pieces from a physics-powered cannon
- **Control power and rotation** for strategic placement
- **Clear lines** using a moving compactor mechanism
- **Watch pieces interact** with realistic physics and breakable joints

## ✨ Features

### 🎯 Core Gameplay
- **7 Tetris Piece Types**: I, O, T, L, J, S, Z pieces with unique visual patterns
- **Physics Simulation**: Realistic piece interactions using Pymunk physics engine
- **Breakable Joints**: Tetris pieces can break apart on impact
- **Line Clearing**: Moving compactor clears completed lines
- **Trajectory Prediction**: See exactly where your pieces will land

### 🎨 Visual Features
- **Unique Patterns**: Each piece type has distinctive internal patterns
  - I-piece: Horizontal lines
  - O-piece: Concentric squares
  - T-piece: Diagonal lines (↘)
  - L-piece: Vertical lines
  - J-piece: Diagonal lines (↙)
  - S-piece: Dotted pattern
  - Z-piece: Cross-hatch pattern
- **Color-Coded Pieces**: Easy identification with bright, distinct colors
- **Blinking Effects**: Pieces blink red before disappearing

### 🎛️ Controls
- **A/D or ←/→**: Aim cannon left/right
- **W/S or ↑/↓**: Increase/decrease power
- **Q/E**: Rotate piece before shooting
- **Space**: Shoot piece
- **? (Shift+/)**: Toggle help instructions
- **Mouse**: Click help button (?) to toggle instructions

### 🔧 Advanced Features
- **Smart Line Detection**: Dynamic line clearing based on compactor position
- **Piece Preview**: See your next piece with rotation
- **Power Control**: Fine-grained power adjustment (400-1000 units)
- **Single-Shot Mechanics**: One piece at a time for strategic gameplay
- **Gravity Manipulation**: Developer keys for testing (G, H, J)

## 🚀 Installation

### Prerequisites
- Python 3.7 or higher
- pip package manager

### Setup
1. **Clone the repository**:
   ```bash
   git clone https://github.com/venetanji/tetrilaunch.git
   cd tetrilaunch
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the game**:
   ```bash
   python main.py
   ```

## 📦 Dependencies

- **pygame**: Graphics, input handling, and game loop
- **pymunk**: 2D physics simulation engine
- **math**: Mathematical calculations for trajectories
- **sys**: System-specific parameters and functions
- **random**: (Legacy - now using sequential piece cycling)

## 🎮 How to Play

1. **Aim Your Cannon**: Use A/D or arrow keys to adjust the cannon angle
2. **Set Power Level**: Use W/S or up/down arrows to control shot strength
3. **Rotate Pieces**: Use Q/E to rotate pieces before shooting
4. **Fire**: Press Space to launch the piece
5. **Clear Lines**: The compactor moves from center to right, clearing full lines
6. **Strategic Placement**: Pieces on the left side of the compactor will blink and disappear

### 🎯 Scoring
- **Line Clears**: 100 points per line cleared
- **Disappearing Pieces**: 50 points per piece that disappears on the left side

## 🛠️ Technical Details

### Architecture
- **Object-Oriented Design**: Modular classes for Cannon, Compactor, and game mechanics
- **Physics Integration**: Seamless integration between Pygame rendering and Pymunk physics
- **Event-Driven Input**: Responsive controls with both discrete and continuous input handling

### Key Components
- **Cannon Class**: Manages aiming, power, and piece rotation
- **Compactor Class**: Handles the moving compression mechanism
- **Physics Bodies**: Individual cubes with breakable joints for realistic piece behavior
- **Pattern Rendering**: Custom drawing functions for unique piece patterns

### Performance
- **60 FPS**: Smooth gameplay with consistent frame rate
- **Efficient Physics**: Optimized collision detection and physics simulation
- **Memory Management**: Proper cleanup of physics bodies and joints

## 🎨 Customization

The game is designed to be easily customizable:

### Colors and Patterns
Modify the `colors` dictionary and pattern drawing functions in `draw_square_piece()` to create new visual styles.

### Physics Parameters
Adjust physics constants like gravity, friction, and joint strength for different gameplay feels.

### Game Mechanics
Tweak scoring, line detection thresholds, and piece behavior in the respective functions.

## 🐛 Troubleshooting

### Common Issues
- **Import Errors**: Ensure pygame and pymunk are installed (`pip install pygame pymunk`)
- **Performance Issues**: Try reducing FPS or physics simulation complexity
- **Control Responsiveness**: Check for conflicting key mappings

### Debug Features
- **G Key**: Toggle gravity direction
- **H/J Keys**: Increase/decrease gravity strength
- **Console Output**: Line clearing debug information

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs and issues
- Suggest new features
- Submit pull requests
- Improve documentation

## 📄 License

This project is open source. Feel free to use, modify, and distribute as needed.

## 🎯 Future Enhancements

Potential improvements and features:
- **Multiple Levels**: Different gravity settings and obstacles
- **Power-ups**: Special pieces with unique abilities
- **Multiplayer Mode**: Competitive or cooperative gameplay
- **Sound Effects**: Audio feedback for actions and events
- **Particle Effects**: Enhanced visual feedback
- **Leaderboards**: Score tracking and competition

## 🙏 Acknowledgments

- **Pygame Community**: For the excellent game development framework
- **Pymunk**: For the robust 2D physics engine
- **Tetris**: For the inspiration of the classic falling block puzzle

---

**Enjoy playing Tetrilaunch!** 🎮✨
