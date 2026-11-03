"""Human matting for FinalPost: Robust Video Matting (MobileNetV3) wrapper.

Phase 2 scope: model loading and sequential, recurrent-state inference only. There is deliberately no
decoder, encoder or service layer here yet. Importing this package does not import torch.
"""
