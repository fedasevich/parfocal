from itertools import pairwise

import torch
from torch import nn


def double_conv(in_channels: int, out_channels: int) -> nn.Module:
    return nn.Sequential(
        nn.InstanceNorm2d(in_channels),
        nn.Conv2d(in_channels, out_channels, 3, padding=1),
        nn.ReLU(inplace=True),
        nn.InstanceNorm2d(out_channels),
        nn.Conv2d(out_channels, out_channels, 3, padding=1),
        nn.ReLU(inplace=True),
    )


class Wrapped(nn.Module):
    def __init__(self, block: nn.Module) -> None:
        super().__init__()
        self.block = block

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


def upsample(in_channels: int, out_channels: int) -> Wrapped:
    return Wrapped(nn.ConvTranspose2d(in_channels, out_channels, 2, stride=2))


def lift(in_channels: int, out_channels: int) -> Wrapped:
    return Wrapped(
        nn.Sequential(
            upsample(in_channels, out_channels),
            Wrapped(nn.Conv2d(out_channels, out_channels, 3, padding=1)),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(True),
        )
    )


def centre_crop(skip: torch.Tensor, like: torch.Tensor) -> torch.Tensor:
    window = tuple(
        slice((have - want) // 2, (have - want) // 2 + want)
        for have, want in zip(skip.shape, like.shape, strict=True)
    )
    return skip[window]


class Expanding(nn.Module):
    def __init__(self, features: list[int]) -> None:
        super().__init__()
        pairs = list(pairwise(features))
        self.blocks = nn.ModuleList([Wrapped(double_conv(a, b)) for a, b in pairs])
        self.samplers = nn.ModuleList([upsample(a, b) for a, b in pairs])

    def forward(self, x: torch.Tensor, skips: list[torch.Tensor]) -> torch.Tensor:
        for block, sampler, skip in zip(self.blocks, self.samplers, skips, strict=True):
            x = sampler(x)
            x = block(torch.cat([x, centre_crop(skip, x)], dim=1))
        return x


class InstanceDecoder(nn.Module):
    def __init__(self, embed: int = 256, features: tuple[int, ...] = (512, 256, 128, 64)) -> None:
        super().__init__()
        self.deconv1 = lift(embed, features[0])
        self.deconv2 = lift(features[0], features[1])
        self.deconv3 = lift(features[1], features[2])
        self.deconv4 = lift(features[2], features[3])
        self.base = Wrapped(double_conv(embed, features[0]))
        self.decoder = Expanding(list(features))
        self.deconv_out = upsample(features[-1], features[-1])
        self.decoder_head = Wrapped(double_conv(2 * features[-1], features[-1]))
        self.out_conv = nn.Conv2d(features[-1], 3, 1)

    def forward(self, embeddings: torch.Tensor) -> torch.Tensor:
        z9 = self.deconv1(embeddings)
        z6 = self.deconv2(z9)
        z3 = self.deconv3(z6)
        z0 = self.deconv4(z3)
        x = self.decoder(self.base(embeddings), [z9, z6, z3])
        x = self.decoder_head(torch.cat([self.deconv_out(x), z0], dim=1))
        return torch.sigmoid(self.out_conv(x))
